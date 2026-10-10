// @vitest-environment node
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { adoptedDimensions, currentDimensionCount, pendingDimensionCount, buildDimensionReviewFacts, commitDimensionReviews, dimensionConflict, latestDimensionReview, reviewedDimension, validateDimensionReview, type DimensionReviewDraft } from "./dimension-review";
import { addDimensionCandidate, dimensionFixture } from "./test/dimension-fixture";
import { localActorId, projectCommands, projectRepository, projectPackages } from "./workbench";
const actor = crypto.randomUUID();
vi.stubGlobal("localStorage", { getItem: () => actor, setItem: () => undefined });
const adopt = (changes: Partial<DimensionReviewDraft> = {}): DimensionReviewDraft => ({
  rowIndex: 0, disposition: "adopt", name: "总宽", valueMm: "6000", checked: true, reason: "", ...changes,
});
async function save(context: Awaited<ReturnType<typeof dimensionFixture>>, drafts = [adopt()]) {
  return commitDimensionReviews({ ...context, drafts, actorId: localActorId(), commands: projectCommands, repository: projectRepository });
}
describe("尺寸候选采用", () => {
  it("真实仓储写入保留模型来源、原文、候选关联及采用命令，不创建现场测量", async () => {
    const context = await dimensionFixture();
    if (process.env.DIMENSION_REVIEW_FIXTURE_OUT) {
      const zip = await projectPackages.exportZip(context.head.projectId);
      expect(projectPackages.parse(zip, "fixture.zip").snapshot.candidates).toEqual(context.head.snapshot.candidates);
      writeFileSync(process.env.DIMENSION_REVIEW_FIXTURE_OUT, zip);
    }
    const result = await save(context);
    const fact = result.head!.snapshot.facts[0]!;
    expect(fact.producer).toEqual({ producerType: "model", runId: context.candidate.runId });
    expect(reviewedDimension(fact)).toMatchObject({ candidateId: context.candidate.id, rowIndex: 0, value: 6000, sourceKind: "document-transcription", original: { valueText: "6000" } });
    expect(fact.acceptanceRef?.type).toBe("command");
    expect(result.head!.snapshot.measurements).toHaveLength(0);
    expect(result.head!.snapshot.candidates[0]).toEqual(context.candidate);
    expect(adoptedDimensions(result.head!.snapshot)).toEqual([{ factRef: fact.id, name: "总宽", valueMm: 6000, evidenceRefs: fact.evidenceRefs, sourceKind: "document-transcription" }]);
  });
  it("人工修正保留旧值，责任人和理由可读回", async () => {
    const context = await dimensionFixture();
    const result = await save(context, [adopt({ valueMm: "6100", reason: "核对原图更正" })]);
    const fact = result.head!.snapshot.facts[0]!;
    expect(fact.producer).toMatchObject({ producerType: "human", actorId: localActorId() });
    expect(reviewedDimension(fact)).toMatchObject({ corrected: true, value: 6100, original: { valueMm: "6000" }, reason: "核对原图更正" });
  });
  it.each(["", "NaN", "Infinity", "-1", "0"])("无效数值 %s 不写入", async (valueMm) => {
    const context = await dimensionFixture();
    await expect(save(context, [adopt({ valueMm })])).rejects.toThrow("有限毫米数值");
    expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toEqual([]);
  });
  it("未核对、空名称、待核实或修改缺说明均被拦截", async () => {
    const { head, candidate } = await dimensionFixture();
    for (const draft of [adopt({ checked: false }), adopt({ name: "" }), adopt({ valueMm: "6200" }), adopt({ rowIndex: 2, name: "层高", valueMm: "3000" })]) {
      expect(validateDimensionReview(head.snapshot, candidate, draft).length).toBeGreaterThan(0);
    }
    expect(validateDimensionReview(head.snapshot, candidate, adopt({ rowIndex: 2, name: "层高", valueMm: "3000", reason: "测试补充记录，非实测" }))).toEqual([]);
  });
  it("缺失资料不能采用，但可有理由地驳回并保留原引用", async () => {
    const { head, candidate } = await dimensionFixture();
    head.snapshot.evidences = [];
    expect(validateDimensionReview(head.snapshot, candidate, adopt())).toContain("原资料缺失或不可用，不能采用。");
    const facts = buildDimensionReviewFacts(head, candidate, [adopt({ disposition: "reject", reason: "资料缺失" })], localActorId(), crypto.randomUUID());
    expect(facts[0]!.evidenceRefs).toEqual([]);
    expect(reviewedDimension(facts[0]!)!.original.evidenceRef).toBe(candidate.evidenceRefs[0]);
    expect(adoptedDimensions({ facts, evidences: [] })).toEqual([]);
  });
  it("同一处置重复保存不增加记录，不同运行相同行号分别保留", async () => {
    const context = await dimensionFixture();
    const first = await save(context);
    const again = await save({ ...context, head: first.head! });
    expect(again.savedCount).toBe(0);
    expect(again.head!.revisionId).toBe(first.head!.revisionId);
    const other = await addDimensionCandidate(first.head!);
    const result = await save(other);
    expect(result.head!.snapshot.facts).toHaveLength(2);
    expect(new Set(result.head!.snapshot.facts.map((fact) => fact.field)).size).toBe(2);
  });
  it("重新核对可驳回原采用，历史保留但可用尺寸不再包含该项", async () => {
    const context = await dimensionFixture();
    const first = await save(context);
    const rejected = await save({ ...context, head: first.head! }, [adopt({ disposition: "reject", reason: "资料适用对象不一致" })]);
    expect(rejected.head!.snapshot.facts).toHaveLength(2);
    expect(adoptedDimensions(rejected.head!.snapshot)).toEqual([]);
    expect(currentDimensionCount(rejected.head!.snapshot)).toBe(0);
    expect(pendingDimensionCount(rejected.head!.snapshot)).toBe(2);
    expect(latestDimensionReview(rejected.head!.snapshot.facts, context.candidate.id, 0)!.reviewStatus).toBe("rejected");
    await expect(save({ ...context, head: rejected.head! }, [adopt({ disposition: "reject" })])).rejects.toThrow("驳回原因");
  });
  it("同名异值必须说明，不自动替换已有来源", async () => {
    const context = await dimensionFixture();
    const first = await save(context);
    const row = context.candidate.structured?.kind === "measurementTranscription" ? context.candidate.structured.dimensions[0]! : null!;
    const other = await addDimensionCandidate(first.head!, [{ ...row, valueMm: "6100", valueText: "6100" }]);
    expect(dimensionConflict(other.head.snapshot, other.candidate, 0, "总宽", "6100")).toBe(true);
    await expect(save(other, [adopt({ valueMm: "6100" })])).rejects.toThrow("同名异值");
    const result = await save(other, [adopt({ valueMm: "6100", reason: "测试同名不同部位，分别保留" })]);
    expect(adoptedDimensions(result.head!.snapshot).map((row) => row.valueMm)).toEqual([6000, 6100]);
  });
  it("重复行、变更候选、过期窗口均不能悄悄覆盖项目", async () => {
    const context = await dimensionFixture();
    await expect(save(context, [adopt(), adopt()])).rejects.toThrow("不重复");
    await expect(save({ ...context, candidate: { ...context.candidate, contentText: "过期内容" } })).rejects.toThrow("候选已变化");
    await save(context);
    await expect(save(context, [adopt({ valueMm: "6200", reason: "旧窗口尝试" })])).rejects.toThrow();
    expect(adoptedDimensions((await projectRepository.getProjectHead(context.head.projectId))!.snapshot)[0]!.valueMm).toBe(6000);
  });
  it("命令成功后读回失败报告已保存，不把刷新故障变成再次写入", async () => {
    const context = await dimensionFixture();
    const result = await commitDimensionReviews({ ...context, drafts: [adopt()], actorId: localActorId(), commands: projectCommands, repository: { getProjectHead: vi.fn().mockRejectedValue(new Error("read failed")) } });
    expect(result).toEqual({ head: null, savedCount: 1 });
    expect((await projectRepository.getProjectHead(context.head.projectId))!.snapshot.facts).toHaveLength(1);
  });
});





