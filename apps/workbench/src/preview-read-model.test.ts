// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildPreviewReadModel, previewCsv, previewInputErrors, validPreviewRegion } from "./preview-read-model";
import { addDimensionCandidate, dimensionFixture } from "./test/dimension-fixture";
import { adoptedDimensions, currentDimensionCount, buildDimensionReviewFacts, commitDimensionReviews, reviewedDimension, type DimensionReviewDraft } from "./dimension-review";
import { localActorId, projectCommands, projectPackages, projectRepository } from "./workbench";
import { taskFromProduction, emptyProductionTask } from "./production-task";
const actor = crypto.randomUUID();
vi.stubGlobal("localStorage", { getItem: () => actor, setItem: () => undefined });
const draft = (valueMm = "0"): DimensionReviewDraft => ({ rowIndex: 0, disposition: "adopt", name: "地坪标高", quantityKind: "relativeElevation", valueMm, checked: true, reason: "" });
async function elevation() {
  const initial = await dimensionFixture();
  const ref = initial.candidate.evidenceRefs[0]!;
  return addDimensionCandidate(initial.head, [{ partZh: "地坪标高", quantityKind: "relativeElevation", region: { x: .1, y: .2, width: .3, height: .1 }, valueText: "±0.000", valueMm: "0", evidenceRef: ref, locationZh: "内部测试标高记录", certainty: "certain", noteZh: "内部测试数据" }]);
}
async function assets(projectId: string) { return (await projectRepository.getProjectAssets(projectId)).map((item) => item.record); }
describe("只读预览与类型规则", () => {
  it.each(["0", "-120"])("标高 %s 可明确采用但不会进入构件长度引用", async (valueMm) => {
    const context = await elevation();
    const result = await commitDimensionReviews({ ...context, drafts: [{ ...draft(valueMm), reason: valueMm === "0" ? "" : "内部更正测试" }], actorId: actor, commands: projectCommands, repository: projectRepository });
    expect(reviewedDimension(result.head!.snapshot.facts.at(-1)!)).toMatchObject({ value: Number(valueMm), quantityKind: "relativeElevation" });
    expect(adoptedDimensions(result.head!.snapshot)).toEqual([]);
    expect(() => buildDimensionReviewFacts(context.head, context.candidate, [{ ...draft(valueMm), quantityKind: "length", reason: "改类型" }], actor, crypto.randomUUID())).toThrow("大于 0");
  });
  it("改变类型必须说明，旧正长度记录仍可引用", async () => {
    const context = await dimensionFixture();
    expect(() => buildDimensionReviewFacts(context.head, context.candidate, [{ ...draft("6000"), name: "总宽" }], actor, crypto.randomUUID())).toThrow("核对说明");
    const facts = buildDimensionReviewFacts(context.head, context.candidate, [{ ...draft("6000"), name: "总宽", quantityKind: "length" }], actor, crypto.randomUUID());
    delete (facts[0]!.value as { quantityKind?: string }).quantityKind;
    expect(adoptedDimensions({ facts, evidences: context.head.snapshot.evidences })).toHaveLength(1);
    (facts[0]!.value as { value: number }).value = 0;
    expect(reviewedDimension(facts[0]!)).toBeNull();
  });
  it("最新采用、修正和驳回改变预览与导出，候选和旧事实不变", async () => {
    const context = await elevation(); const metadata = await assets(context.head.projectId);
    const before = JSON.stringify(context.head.snapshot);
    const unreviewed = buildPreviewReadModel(context.head.snapshot, metadata).rows.at(-1)!;
    expect(unreviewed).toMatchObject({ originalText: "±0.000", status: "pending", adoptedMm: null, sourceHash: metadata[0]!.sha256 });
    expect(JSON.stringify(context.head.snapshot)).toBe(before);
    const original = context.candidate;
    const save = async (head: typeof context.head, changes: Partial<DimensionReviewDraft> = {}) => commitDimensionReviews({ head, candidate: original, drafts: [{ ...draft(), ...changes }], actorId: actor, commands: projectCommands, repository: projectRepository });
    const first = (await save(context.head)).head!;
    const corrected = (await save(first, { valueMm: "-120", reason: "内部修正测试" })).head!;
    const model = buildPreviewReadModel(corrected.snapshot, metadata); const row = model.rows.at(-1)!;
    expect(row).toMatchObject({ originalText: "±0.000", candidateMm: "0", adoptedMm: -120, status: "corrected", quantityKind: "relativeElevation" });
    const csv = previewCsv(model); expect(csv).toContain('"相对标高","已修正","±0.000","0","-120"'); expect(csv).toContain(metadata[0]!.sha256);
    const exported = projectPackages.parse(await projectPackages.exportZip(corrected.projectId), "preview.zip");
    expect(buildPreviewReadModel(exported.snapshot, exported.assets)).toEqual(model);
    const restored = exported.snapshot.candidates.at(-1)!.structured;
    expect(restored?.kind === "measurementTranscription" && restored.dimensions[0]!.region).toEqual({ x: .1, y: .2, width: .3, height: .1 });
    const rejected = (await save(corrected, { disposition: "reject", reason: "内部驳回测试" })).head!;
    expect(buildPreviewReadModel(rejected.snapshot, metadata).rows.at(-1)).toMatchObject({ status: "rejected", adoptedMm: null });
    expect(rejected.snapshot.facts).toHaveLength(3); expect(rejected.snapshot.candidates.at(-1)).toEqual(original);
  });
  it("有效区域保留原坐标，越界、无区域、非图像和缺原件如实显示", async () => {
    const context = await dimensionFixture(); const snapshot = context.head.snapshot; const metadata = await assets(context.head.projectId);
    const candidate = snapshot.candidates[0]!; if (candidate.structured?.kind !== "measurementTranscription") throw new Error("test");
    const region = { x: .1, y: .2, width: .3, height: .1 }; candidate.structured.dimensions[0]!.region = region;
    expect(buildPreviewReadModel(snapshot, metadata).rows[0]).toMatchObject({ region: null, locationIssue: "当前资料不是可定位图像" });
    snapshot.parseRecords[0]!.readability = "readable"; snapshot.parseRecords[0]!.readableAs = "image";
    expect(buildPreviewReadModel(snapshot, metadata).rows[0]!.region).toEqual(region);
    candidate.structured.dimensions[0]!.region = { ...region, x: .9 };
    expect(buildPreviewReadModel(snapshot, metadata).rows[0]).toMatchObject({ region: null, locationIssue: "图上区域越界或无效" });
    expect(buildPreviewReadModel(snapshot, metadata).rows[1]!.locationIssue).toBe("未提供图上区域");
    expect(buildPreviewReadModel(snapshot, []).rows[0]).toMatchObject({ status: "unavailable", sourceHash: null, locationIssue: "原件缺失或不可用" });
    expect(validPreviewRegion({ ...region, width: Number.NaN })).toBe(false);
    expect(validPreviewRegion({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });
  it("生成前缺设置、空选择及不可读输入有具体原因，完整设置允许开始", async () => {
    const context = await dimensionFixture(); const snapshot = context.head.snapshot; const id = snapshot.evidences[0]!.id;
    expect(previewInputErrors(snapshot, [id])[0]).toContain("任务卡");
    snapshot.taskDefinitions = [taskFromProduction({ ...emptyProductionTask(), taskName: "预览内部测试", buildingName: "内部建筑" }, snapshot.buildings[0]!.id, localActorId())];
    expect(previewInputErrors(snapshot, [id])).toEqual([]); expect(previewInputErrors(snapshot, [])).toEqual(["请至少勾选一份可读资料。"]);
    expect(previewInputErrors(snapshot, [crypto.randomUUID()])).toEqual(["所选资料尚不可读，请完成读取或调整选择。"]);
  });
  it("整体被替代和整体驳回的候选只供查看，不显示旧采用值为当前成果", async () => {
    const context = await elevation(); const metadata = await assets(context.head.projectId);
    const adopted = (await commitDimensionReviews({ ...context, drafts: [draft()], actorId: actor, commands: projectCommands, repository: projectRepository })).head!;
    adopted.snapshot.candidates.at(-1)!.reviewStatus = "superseded";
    expect(adoptedDimensions(adopted.snapshot)).toEqual([]); expect(currentDimensionCount(adopted.snapshot)).toBe(0);
    expect(buildPreviewReadModel(adopted.snapshot, metadata).rows.at(-1)).toMatchObject({ status: "inactive", adoptedMm: null, reviewable: false });
    adopted.snapshot.candidates.at(-1)!.reviewStatus = "rejected";
    expect(adoptedDimensions(adopted.snapshot)).toEqual([]);
    expect(buildPreviewReadModel(adopted.snapshot, metadata).rows.at(-1)).toMatchObject({ status: "rejected", adoptedMm: null, reviewable: false });
  });
});
