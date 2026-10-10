// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { IndexedDbProjectRepository, openWorkbenchDatabase, ProjectPackageService } from "@gujian/infrastructure";
import { candidateDimensions, commitDraftGeometryComponent, draftGeometryPreview } from "./draft-geometry";
import { componentDraft, componentInputs } from "./component-input";
import { buildDimensionReviewFacts, reviewedDimension } from "./dimension-review";
import { addDimensionCandidate, dimensionFixture } from "./test/dimension-fixture";
import { componentFixture } from "./test/component-fixture";
import { localActorId, projectCommands, projectPackages, projectRepository } from "./workbench";

const actor = crypto.randomUUID();
vi.stubGlobal("localStorage", { getItem: () => actor, setItem: () => undefined });
async function rawFixture() {
  const context = await dimensionFixture();
  const draft = componentDraft();
  Object.assign(draft, { name: "内部测试墙", componentType: "wall", sourceLocation: "内部资料的人工定位记录", coordinates: ["3000", "120", "1500"],
    evidenceRefs: [context.head.snapshot.evidences[0]!.id], candidateBindings: { sizeX: { candidateId: context.candidate.id, rowIndex: 0 } } });
  draft.lengths.sizeX = "6000"; draft.lengths.sizeY = "240"; draft.lengths.sizeZ = "3000";
  return { ...context, draft };
}
function save(context: Awaited<ReturnType<typeof rawFixture>>, repository = projectRepository, commands = projectCommands) {
  return commitDraftGeometryComponent({ ...context, actorId: localActorId(), repository, commands });
}

describe("待核对形体数据", () => {
  it("纯预览使用草稿当前值、稳定键与候选原文，不写项目事实或几何版本", async () => {
    const context = await rawFixture();
    const original = JSON.stringify(context.head.snapshot);
    const first = draftGeometryPreview(context.head.snapshot, context.draft);
    expect(first.component).toMatchObject({ stableKey: context.draft.stableKey, materialCode: "unknown", solid: { sizeX: "6000", centerMm: [3000, 120, 1500] } });
    expect(first.sources[0]).toMatchObject({ kind: "candidate", originalText: "6000", valueMm: "6000", evidenceId: context.head.snapshot.evidences[0]!.id, selection: { candidateId: context.candidate.id, rowIndex: 0 } });
    context.draft.lengths.sizeX = "6100.5";
    expect(draftGeometryPreview(context.head.snapshot, context.draft).component?.solid).toMatchObject({ sizeX: "6100.5" });
    expect(JSON.stringify(context.head.snapshot)).toBe(original);
    const persisted = (await projectRepository.getProjectHead(context.head.projectId))!;
    expect(persisted.revisionId).toBe(context.head.revisionId);
    expect(persisted.snapshot.facts).toEqual([]); expect(persisted.snapshot.geometryRevisions).toEqual([]);
    const selectedSource = draftGeometryPreview(context.head.snapshot, { ...context.draft, evidenceRefs: [] });
    expect(selectedSource.component?.evidenceRefs).toEqual(context.draft.evidenceRefs);
    expect(selectedSource.sources.filter((item) => item.kind === "manual").map((item) => item.evidenceId)).toEqual([context.draft.evidenceRefs[0], context.draft.evidenceRefs[0]]);
  });

  it("已采用与直接输入的来源可区分，材料未知不推断且形体形式保持", async () => {
    const context = await componentFixture(); const draft = componentDraft(context.component);
    draft.bindings.sizeX = context.dimension.id; draft.material = "";
    const preview = draftGeometryPreview(context.head.snapshot, draft, context.component);
    expect(preview.errors).toEqual({});
    expect(preview.sources.map((item) => item.kind)).toEqual(["adopted", "manual", "manual"]);
    expect(preview.sources[0]).toMatchObject({ originalText: "6000", locationText: "测试记录第 1 行", evidenceId: context.component.evidenceRefs[0] });
    expect(preview.component!.solid).toEqual(context.component.solid);
    expect(preview.component!.dimensionBindings).toEqual([{ field: "sizeX", sourceFactRef: context.dimension.id }]);
    expect(preview.component!.unknowns).toEqual([expect.objectContaining({ reasonCode: "material-unknown", requiredEvidence: ["材料调查记录"] })]);
  });

  it("候选及已采用参数来源保留原件标注区域，直接输入不推断区域", async () => {
    const context = await rawFixture();
    const region = { x: 0.12, y: 0.25, width: 0.3, height: 0.08 };
    const updated = await addDimensionCandidate(context.head, [{ partZh: "总宽", valueText: "6000", valueMm: "6000",
      evidenceRef: context.head.snapshot.evidences[0]!.id, locationZh: "内部测试资料标注区域", region, certainty: "certain", noteZh: "仅用于原件定位测试" }]);
    context.head = updated.head;
    context.draft.candidateBindings!.sizeX = { candidateId: updated.candidate.id, rowIndex: 0 };
    expect(candidateDimensions(context.head.snapshot).find((item) => item.selection.candidateId === updated.candidate.id)).toMatchObject({ region });
    const pending = draftGeometryPreview(context.head.snapshot, context.draft);
    expect(pending.sources[0]).toMatchObject({ kind: "candidate", region, evidenceId: context.draft.evidenceRefs[0] });
    expect(pending.sources.filter((source) => source.kind === "manual").every((source) => !Object.hasOwn(source, "region"))).toBe(true);
    const saved = await save(context);
    expect(reviewedDimension(saved.head!.snapshot.facts[0]!)!.original.region).toEqual(region);
    const component = componentInputs(saved.head!.snapshot)[0]!;
    const adopted = draftGeometryPreview(saved.head!.snapshot, componentDraft(component), component);
    expect(adopted.sources[0]).toMatchObject({ kind: "adopted", region, evidenceId: context.draft.evidenceRefs[0] });
    expect(adopted.component!.solid).toEqual(component.solid);
  });

  it("候选长度在圆柱及轮廓挤出中保留轴向、毫米坐标和原形体参数", async () => {
    const context = await rawFixture(); const selection = context.draft.candidateBindings!.sizeX!;
    const cylinder = { ...context.draft, kind: "cylinder" as const, axis: "x" as const, candidateBindings: { height: selection }, lengths: { ...context.draft.lengths, radius: "200", height: "6000" } };
    expect(draftGeometryPreview(context.head.snapshot, cylinder).component?.solid).toEqual({ kind: "cylinder", radius: "200", height: "6000", axis: "x", centerMm: [3000, 120, 1500] });
    const profile = { ...context.draft, kind: "extrudedProfile" as const, axis: "y" as const, candidateBindings: { depth: selection }, lengths: { ...context.draft.lengths, depth: "6000" }, profile: [["0", "0"], ["20", "0"], ["20", "10"]] as [string, string][] };
    expect(draftGeometryPreview(context.head.snapshot, profile).component?.solid).toEqual({ kind: "extrudedProfile", depth: "6000", axis: "y", originMm: [3000, 120, 1500], profileMm: [[0, 0], [20, 0], [20, 10]] });
  });

  it("候选列表只包含当前项目可读可用且待核对的正长度，并保留类型未定", async () => {
    const context = await rawFixture();
    expect(candidateDimensions(context.head.snapshot)).toHaveLength(2);
    expect(candidateDimensions(context.head.snapshot)[0]).toMatchObject({ quantityKind: "unspecified", valueMm: "6000" });
    const snapshot = structuredClone(context.head.snapshot);
    const rows = snapshot.candidates[0]!.structured;
    if (rows?.kind !== "measurementTranscription") throw new Error("missing test dimensions");
    rows.dimensions[0]!.quantityKind = "relativeElevation";
    rows.dimensions[1]!.valueMm = "Infinity";
    expect(candidateDimensions(snapshot)).toEqual([]);
    snapshot.candidates[0]!.projectId = crypto.randomUUID();
    expect(candidateDimensions(snapshot)).toEqual([]);
    snapshot.candidates = context.head.snapshot.candidates;
    snapshot.parseRecords = [...snapshot.parseRecords, { ...snapshot.parseRecords.at(-1)!, id: crypto.randomUUID(), readability: "failed", status: "failed" }];
    expect(candidateDimensions(snapshot)).toEqual([]);
  });

  it("无长度、无坐标或明确位置依据、规则位置均不形成预览", async () => {
    const context = await rawFixture();
    for (const change of [
      { lengths: { ...context.draft.lengths, sizeX: "" } }, { coordinates: ["", "0", "0"] as [string, string, string] },
      { sourceLocation: "" }, { positionBasis: "rule" as const }, { positionBasis: "demo" as const },
    ]) expect(draftGeometryPreview(context.head.snapshot, { ...context.draft, ...change }).component).toBeNull();
    const relative = structuredClone(context.head.snapshot);
    if (relative.candidates[0]!.structured?.kind === "measurementTranscription") relative.candidates[0]!.structured.dimensions[0]!.quantityKind = "relativeElevation";
    expect(draftGeometryPreview(relative, context.draft).errors.sizeX).toContain("相对标高");
  });

  it("候选拒绝、替代、单行驳回、不可读和已失效引用不退回手填值", async () => {
    const context = await rawFixture();
    for (const status of ["rejected", "superseded"] as const) {
      const snapshot = structuredClone(context.head.snapshot); snapshot.candidates[0]!.reviewStatus = status;
      expect(draftGeometryPreview(snapshot, context.draft).errors.sizeX).toContain("驳回");
    }
    const rejected = buildDimensionReviewFacts(context.head, context.candidate, [{ rowIndex: 0, disposition: "reject", name: "总宽", valueMm: "6000", checked: true, reason: "内部测试驳回" }], actor, crypto.randomUUID());
    const snapshot = { ...context.head.snapshot, facts: rejected };
    expect(candidateDimensions(snapshot).map((item) => item.selection.rowIndex)).toEqual([1]);
    expect(draftGeometryPreview(snapshot, context.draft).component).toBeNull();
    const unavailable = structuredClone(context.head.snapshot); unavailable.evidences[0]!.dataStatus = "missing";
    expect(draftGeometryPreview(unavailable, context.draft).errors.sizeX).toContain("不可用");
    const disappeared = { ...context.head.snapshot, candidates: [] };
    expect(draftGeometryPreview(disappeared, context.draft).errors.sizeX).toContain("不存在");
    const invalid = structuredClone(context.head.snapshot);
    if (invalid.candidates[0]!.structured?.kind === "measurementTranscription") invalid.candidates[0]!.structured.dimensions[0]!.valueMm = "NaN";
    expect(draftGeometryPreview(invalid, context.draft).errors.sizeX).toContain("有效");
    const adopted = await componentFixture(); const draft = componentDraft(adopted.component); draft.bindings.sizeX = crypto.randomUUID();
    expect(draftGeometryPreview(adopted.head.snapshot, draft).errors.sizeX).toContain("失效");
  });

  it("同一字段不能同时绑定两种来源，同一候选跨字段必须使用同一修正值", async () => {
    const context = await rawFixture();
    const doubled = { ...context.draft, bindings: { sizeX: crypto.randomUUID() } };
    expect(draftGeometryPreview(context.head.snapshot, doubled).errors.sizeX).toContain("同时");
    context.draft.candidateBindings!.sizeY = context.draft.candidateBindings!.sizeX!;
    expect(draftGeometryPreview(context.head.snapshot, context.draft).errors.sizeY).toContain("一致");
    context.draft.lengths.sizeY = "6000";
    expect(draftGeometryPreview(context.head.snapshot, context.draft).errors).toEqual({});
    const saved = await save(context);
    expect(saved.head!.snapshot.facts).toHaveLength(2);
    const component = componentInputs(saved.head!.snapshot)[0]!;
    expect(component.dimensionBindings?.map((item) => item.sourceFactRef)).toEqual([saved.head!.snapshot.facts[0]!.id, saved.head!.snapshot.facts[0]!.id]);
  });

  it("修正或同名异值保存前需要说明，预览允许修正且失败不写任何事实", async () => {
    const context = await rawFixture(); context.draft.lengths.sizeX = "6100";
    expect(draftGeometryPreview(context.head.snapshot, context.draft).component).not.toBeNull();
    await expect(save(context)).rejects.toThrow("核对说明");
    expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toEqual([]);
    context.draft.candidateReason = "核对内部资料后更正，非实测记录";
    const saved = await save(context);
    expect(reviewedDimension(saved.head!.snapshot.facts[0]!)).toMatchObject({ corrected: true, quantityKind: "length", value: 6100, original: { valueMm: "6000" }, reason: context.draft.candidateReason });
  });

  it("合法省略标注类型的确定正数候选，明确长度字段后原值可无说明原子保存", async () => {
    const context = await rawFixture();
    const original = context.candidate.structured?.kind === "measurementTranscription" ? context.candidate.structured.dimensions[0]! : null!;
    expect(original).not.toHaveProperty("quantityKind");
    expect(original).toMatchObject({ certainty: "certain", valueMm: "6000" });
    expect(context.draft.candidateReason).toBeUndefined();
    const saved = await save(context);
    expect(saved.head!.snapshot.facts).toHaveLength(2);
    const fact = saved.head!.snapshot.facts[0]!;
    const reviewed = reviewedDimension(fact)!;
    expect(reviewed).toMatchObject({ quantityKind: "length", corrected: false, value: 6000, reason: "" });
    expect(reviewed.original).toEqual(original);
    expect(reviewed.original).not.toHaveProperty("quantityKind");
    expect(fact.producer).toEqual({ producerType: "model", runId: context.candidate.runId });
    expect(componentInputs(saved.head!.snapshot)[0]!.dimensionBindings).toEqual([{ field: "sizeX", sourceFactRef: fact.id }]);
  });

  it("类型未定且数值未改的待核实候选仍需说明，缺说明保持零写入", async () => {
    const context = await rawFixture();
    const updated = await addDimensionCandidate(context.head, [{ partZh: "测试待核实长度", valueText: "6000?", valueMm: "6000",
      evidenceRef: context.head.snapshot.evidences[0]!.id, locationZh: "内部测试待核实行", certainty: "uncertain", noteZh: "本测试不调用模型" }]);
    context.head = updated.head;
    context.draft.candidateBindings!.sizeX = { candidateId: updated.candidate.id, rowIndex: 0 };
    expect(draftGeometryPreview(context.head.snapshot, context.draft).component).not.toBeNull();
    await expect(save(context)).rejects.toThrow("核对说明");
    expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toEqual([]);
    context.draft.candidateReason = "已核对内部测试原文，明确用于构件长度";
    const saved = await save(context);
    expect(reviewedDimension(saved.head!.snapshot.facts[0]!)).toMatchObject({ quantityKind: "length", corrected: false, value: 6000, reason: context.draft.candidateReason });
  });

  it("同名异值来源保留冲突，缺说明不采用，说明明确后保留候选原文", async () => {
    const context = await rawFixture();
    const updated = await addDimensionCandidate(context.head, [{ partZh: "总宽", valueText: "6100", valueMm: "6100", evidenceRef: context.head.snapshot.evidences[0]!.id,
      locationZh: "内部测试第二来源", quantityKind: "length", certainty: "certain", noteZh: "仅用于冲突测试" }]);
    context.head = updated.head;
    await expect(save(context)).rejects.toThrow("同名异值");
    expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toEqual([]);
    context.draft.candidateReason = "核对内部资料第1行，本次采用6000毫米";
    const saved = await save(context);
    expect(reviewedDimension(saved.head!.snapshot.facts[0]!)).toMatchObject({ value: 6000, original: { valueText: "6000" }, reason: context.draft.candidateReason });
  });

  it("尺寸采用和构件通过同一 CommitFacts 原子写入，保持稳定身份及来源", async () => {
    const context = await rawFixture();
    const execute = vi.spyOn(projectCommands, "execute");
    try {
      const saved = await save(context);
      expect(execute).toHaveBeenCalledTimes(1);
      const command = execute.mock.calls[0]![0] as { commandId: string; commandType: string; payload: { facts: typeof context.head.snapshot.facts } };
      expect(command.commandType).toBe("CommitFacts"); expect(command.payload.facts).toHaveLength(2);
      expect(command.payload.facts.map((item) => item.acceptanceRef?.id)).toEqual([command.commandId, command.commandId]);
      const dimension = saved.head!.snapshot.facts[0]!;
      expect(reviewedDimension(dimension)).toMatchObject({ quantityKind: "length", candidateId: context.candidate.id, rowIndex: 0, corrected: false });
      expect(componentInputs(saved.head!.snapshot)[0]).toMatchObject({ stableKey: context.draft.stableKey, dimensionBindings: [{ field: "sizeX", sourceFactRef: dimension.id }] });
      expect(saved.head!.snapshot.candidates[0]).toEqual(context.candidate);
      expect(saved.head!.snapshot.measurements).toEqual([]); expect(saved.head!.snapshot.geometryRevisions).toEqual([]);
    } finally { execute.mockRestore(); }
  });

  it("命令提交失败保持零写入，保存读回失败不会重复执行", async () => {
    const context = await rawFixture();
    const execute = vi.spyOn(projectCommands, "execute").mockRejectedValueOnce(new Error("injected commit failure"));
    try {
      await expect(save(context)).rejects.toThrow("injected commit failure");
      expect(execute).toHaveBeenCalledTimes(1);
      expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toEqual([]);
    } finally { execute.mockRestore(); }
    const writes = vi.spyOn(projectCommands, "execute");
    try {
      const saved = await commitDraftGeometryComponent({ ...context, actorId: actor, commands: projectCommands, repository: { getProjectHead: vi.fn().mockRejectedValue(new Error("read failed")) } });
      expect(saved.head).toBeNull(); expect(writes).toHaveBeenCalledTimes(1);
      expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toHaveLength(2);
    } finally { writes.mockRestore(); }
  });

  it("项目版本改变时原子命令失败，不产生半份尺寸或构件", async () => {
    const context = await rawFixture();
    await projectCommands.execute({ commandType: "CommitFacts", commandId: crypto.randomUUID(), projectId: context.head.projectId, actorId: actor,
      expectedRevisionId: context.head.revisionId, issuedAt: new Date().toISOString(), payload: { facts: buildDimensionReviewFacts(context.head, context.candidate,
        [{ rowIndex: 1, disposition: "adopt", name: "总深", valueMm: "4200", checked: true, reason: "" }], actor, crypto.randomUUID()) } });
    await expect(save(context)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const current = (await projectRepository.getProjectHead(context.head.projectId))!;
    expect(current.snapshot.facts).toHaveLength(1); expect(componentInputs(current.snapshot)).toEqual([]);
  });

  it("已保存输入 ZIP 导出后独立仓储恢复引用、稳定键、材料未知和原资料", async () => {
    const context = await rawFixture(); const saved = await save(context);
    const zip = await projectPackages.exportZip(context.head.projectId);
    const db = openWorkbenchDatabase("draft-geometry-recovery-" + crypto.randomUUID());
    try {
      const repository = new IndexedDbProjectRepository(db); const packages = new ProjectPackageService(repository);
      await packages.import(zip, "draft-input.zip", actor);
      const head = (await repository.getProjectHead(context.head.projectId))!;
      expect(head.snapshot.facts).toEqual(saved.head!.snapshot.facts);
      expect(head.snapshot.facts).toHaveLength(2);
      expect(reviewedDimension(head.snapshot.facts[0]!)).toMatchObject({ quantityKind: "length", value: 6000, candidateId: context.candidate.id });
      expect(componentInputs(head.snapshot)[0]).toMatchObject({ stableKey: context.draft.stableKey, materialCode: "unknown", unknowns: [expect.objectContaining({ reasonCode: "material-unknown" })] });
      const component = componentInputs(head.snapshot)[0]!;
      expect(component.dimensionBindings).toEqual([{ field: "sizeX", sourceFactRef: head.snapshot.facts[0]!.id }]);
      expect(draftGeometryPreview(head.snapshot, componentDraft(component), component).component).toEqual(component);
      expect((await repository.getAsset(head.snapshot.evidences[0]!.assetId)).content.size).toBeGreaterThan(0);
      expect(head.snapshot.geometryRevisions).toEqual([]);
    } finally { (await db).close(); }
  });
});
