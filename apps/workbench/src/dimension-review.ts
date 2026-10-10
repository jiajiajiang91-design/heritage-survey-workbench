import { z } from "zod";
import { FactEnvelopeSchema, ModelCandidateSchema, TranscribedDimensionSchema, isMaterialCoverageFact, type FactEnvelope, type ModelCandidate } from "@gujian/domain";
import type { ProjectHead, ProjectCommandService } from "@gujian/application";
import { dimensionLengthSourceProblem } from "@gujian/infrastructure";

type Snapshot = ProjectHead["snapshot"];
export interface DimensionReviewDraft {
  rowIndex: number;
  quantityKind?: "length" | "relativeElevation";
  disposition: "adopt" | "reject";
  name: string;
  valueMm: string;
  checked: boolean;
  reason: string;
}
const ReviewValueSchema = z.object({
  kind: z.literal("dimensionCandidateReview"),
  disposition: z.enum(["adopt", "reject"]),
  name: z.string(),
  quantityKind: z.enum(["length", "relativeElevation"]).optional(),
  value: z.number().finite().nullable(),
  unit: z.literal("mm"),
  methodZh: z.string(),
  sourceKind: z.literal("document-transcription"),
  candidateId: z.string().uuid(),
  runId: z.string().uuid(),
  rowIndex: z.number().int().nonnegative(),
  original: TranscribedDimensionSchema,
  reason: z.string(),
  corrected: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.value !== null && (value.quantityKind ?? "length") === "length" && value.value <= 0)
    context.addIssue({ code: "custom", message: "长度须大于零", path: ["value"] });
});
export type ReviewedDimensionValue = z.infer<typeof ReviewValueSchema>;
export function reviewedDimension(fact: FactEnvelope): ReviewedDimensionValue | null {
  const result = ReviewValueSchema.safeParse(fact.value);
  return result.success ? result.data : null;
}
export function latestFacts(facts: readonly FactEnvelope[]): FactEnvelope[] {
  return [...new Map(facts.map((fact) => [fact.subjectRef + ":" + fact.field, fact])).values()];
}
export function dimensionReviewField(candidateId: string, rowIndex: number) {
  return "documentedDimension.candidate." + candidateId + "." + rowIndex;
}
export function latestDimensionReview(facts: readonly FactEnvelope[], candidateId: string, rowIndex: number) {
  return [...facts].reverse().find((fact) => fact.field === dimensionReviewField(candidateId, rowIndex)) ?? null;
}
export function dimensionFactIsCurrent(fact: FactEnvelope, snapshot: Partial<Pick<Snapshot, "candidates">>): boolean {
  const value = reviewedDimension(fact);
  const candidate = value && snapshot.candidates?.find((item) => item.id === value.candidateId);
  return !candidate || (candidate.reviewStatus !== "rejected" && candidate.reviewStatus !== "superseded");
}
export function adoptedDimensions(snapshot: Pick<Snapshot, "facts" | "evidences"> & Partial<Pick<Snapshot, "candidates" | "project">>) {
  return latestFacts(snapshot.facts).flatMap((fact) => {
    const value = reviewedDimension(fact);
    return value?.disposition === "adopt" && value.value !== null && (value.quantityKind ?? "length") === "length"
      && dimensionFactIsCurrent(fact, snapshot) && fact.reviewStatus === "confirmed" && fact.dataStatus === "available"
      && (!snapshot.candidates || !dimensionLengthSourceProblem({ ...snapshot, candidates: snapshot.candidates }, fact))
      && fact.evidenceRefs.every((ref) => snapshot.evidences.some((item) => item.id === ref && item.dataStatus === "available"))
      ? [{ factRef: fact.id, name: value.name, valueMm: value.value, evidenceRefs: fact.evidenceRefs, sourceKind: value.sourceKind }] : [];
  });
}
export function dimensionConflict(snapshot: Snapshot, candidate: ModelCandidate, rowIndex: number, name: string, valueMm: string): boolean {
  const key = name.trim();
  const numeric = Number(valueMm);
  if (!key || !Number.isFinite(numeric)) return false;
  const candidates = snapshot.candidates.flatMap((item) => item.structured?.kind === "measurementTranscription"
    ? item.structured.dimensions.filter((row, index) => !(item.id === candidate.id && index === rowIndex)
      && row.partZh?.trim() === key && row.valueMm?.trim() && Number.isFinite(Number(row.valueMm)) && Number(row.valueMm) !== numeric) : []);
  const facts = latestFacts(snapshot.facts).some((fact) => {
    if (fact.field === dimensionReviewField(candidate.id, rowIndex) || fact.reviewStatus !== "confirmed" || fact.dataStatus !== "available") return false;
    const value = fact.value as { name?: unknown; value?: unknown } | null;
    return value && typeof value === "object" && value.name === key && typeof value.value === "number" && value.value !== numeric;
  });
  return candidates.length > 0 || facts;
}
export function validateDimensionReview(snapshot: Snapshot, candidate: ModelCandidate, draft: DimensionReviewDraft): string[] {
  const row = candidate.structured?.kind === "measurementTranscription" ? candidate.structured.dimensions[draft.rowIndex] : null;
  if (!row || !Number.isInteger(draft.rowIndex) || draft.rowIndex < 0) return ["候选条目已不存在，请重新载入项目。"];
  const errors: string[] = [];
  if (draft.reason.trim().length > 2000) errors.push("核对说明不能超过 2000 字。");
  if (draft.disposition === "reject") return draft.reason.trim() ? errors : [...errors, "请填写驳回原因。"];
  if (!draft.checked) errors.push("请先核对原资料并勾选已核对。");
  if (!draft.name.trim() || draft.name.trim().length > 120) errors.push("尺寸名称应为 1 至 120 字。");
  const quantityKind = draft.quantityKind ?? row.quantityKind ?? "length";
  if (quantityKind !== "length" && quantityKind !== "relativeElevation") errors.push("请选择有效的标注类型。");
  if (!draft.valueMm.trim() || !Number.isFinite(Number(draft.valueMm))) errors.push("请输入有限毫米数值。");
  else if (quantityKind === "length" && Number(draft.valueMm) <= 0) errors.push("长度请输入大于 0 的有限毫米数值。");
  if (!snapshot.evidences.some((item) => item.id === row.evidenceRef && item.dataStatus === "available")) errors.push("原资料缺失或不可用，不能采用。");
  const changed = draft.name.trim() !== (row.partZh ?? "").trim() || Number(draft.valueMm) !== Number(row.valueMm) || quantityKind !== (row.quantityKind ?? "length");
  const conflict = dimensionConflict(snapshot, candidate, draft.rowIndex, draft.name, draft.valueMm);
  if ((row.certainty === "uncertain" || changed || conflict) && !draft.reason.trim()) errors.push("待核实、修正或同名异值的条目需要填写核对说明。");
  return errors;
}
export function buildDimensionReviewFacts(head: ProjectHead, candidate: ModelCandidate, drafts: readonly DimensionReviewDraft[], actorId: string, commandId: string): FactEnvelope[] {
  const stored = head.snapshot.candidates.find((item) => item.id === candidate.id);
  if (!stored || stored.projectId !== head.projectId || JSON.stringify(ModelCandidateSchema.parse(stored)) !== JSON.stringify(ModelCandidateSchema.parse(candidate))) throw new Error("候选已变化，请重新载入后核对。");
  if (stored.reviewStatus === "rejected" || stored.reviewStatus === "superseded") throw new Error("本次候选已整体驳回或被替代，不能继续采用。");
  if (!drafts.length || drafts.length > 200 || new Set(drafts.map((row) => row.rowIndex)).size !== drafts.length) throw new Error("请选择不重复的候选条目。");
  return drafts.flatMap((draft) => {
    if (draft.disposition !== "adopt" && draft.disposition !== "reject") throw new Error("请选择有效的处置方式。");
    const errors = validateDimensionReview(head.snapshot, stored, draft);
    if (errors.length) throw new Error("第 " + (draft.rowIndex + 1) + " 条：" + errors.join(" "));
    if (stored.structured?.kind !== "measurementTranscription") throw new Error("候选类型不支持尺寸核对。");
    const row = stored.structured.dimensions[draft.rowIndex]!;
    const quantityKind = draft.quantityKind ?? row.quantityKind ?? "length";
    const corrected = draft.disposition === "adopt" && (draft.name.trim() !== (row.partZh ?? "").trim() || Number(draft.valueMm) !== Number(row.valueMm) || quantityKind !== (row.quantityKind ?? "length"));
    const value: ReviewedDimensionValue = {
      kind: "dimensionCandidateReview", disposition: draft.disposition,
      name: draft.disposition === "adopt" ? draft.name.trim() : row.partZh ?? "未定名尺寸",
      value: draft.disposition === "adopt" ? Number(draft.valueMm) : null, unit: "mm",
      methodZh: "资料转写；原标注 " + row.valueText + (row.locationZh ? "；" + row.locationZh : ""),
      ...((draft.quantityKind ?? row.quantityKind) ? { quantityKind } : {}),
      sourceKind: "document-transcription", candidateId: stored.id, runId: stored.runId,
      rowIndex: draft.rowIndex, original: row, reason: draft.reason.trim(), corrected,
    };
    const previous = latestDimensionReview(head.snapshot.facts, stored.id, draft.rowIndex);
    if (previous && JSON.stringify(reviewedDimension(previous)) === JSON.stringify(value)) return [];
    return [FactEnvelopeSchema.parse({
      id: crypto.randomUUID(), subjectRef: head.snapshot.buildings[0]?.id ?? head.projectId,
      field: dimensionReviewField(stored.id, draft.rowIndex), value,
      producer: corrected ? { producerType: "human", actorId, actionRef: { commandId } } : { producerType: "model", runId: stored.runId },
      evidenceRefs: head.snapshot.evidences.some((item) => item.id === row.evidenceRef) ? [row.evidenceRef] : [],
      reviewStatus: draft.disposition === "adopt" ? "confirmed" : "rejected",
      dataStatus: draft.disposition === "adopt" ? "available" : "uncertain",
      acceptanceRef: { type: "command", id: commandId },
      ...(value.reason ? { reasonZh: value.reason } : {}),
    })];
  });
}
export async function commitDimensionReviews(input: {
  head: ProjectHead; candidate: ModelCandidate; drafts: readonly DimensionReviewDraft[]; actorId: string;
  commands: ProjectCommandService; repository: { getProjectHead(projectId: string): Promise<ProjectHead | null> };
}) {
  const commandId = crypto.randomUUID();
  const facts = buildDimensionReviewFacts(input.head, input.candidate, input.drafts, input.actorId, commandId);
  if (facts.length) {
    await input.commands.execute({
      commandType: "CommitFacts", commandId, projectId: input.head.projectId, actorId: input.actorId,
      expectedRevisionId: input.head.revisionId, issuedAt: new Date().toISOString(), payload: { facts },
    });
  }
  // 写入已经成功；读回失败由调用方明确报告，不能诱发重复保存。
  const head = await input.repository.getProjectHead(input.head.projectId).catch(() => null);
  return { head, savedCount: facts.length };
}




export function currentDimensionCount(snapshot: Pick<Snapshot, "facts" | "measurements"> & Partial<Pick<Snapshot, "candidates">>): number {
  return snapshot.measurements.length + dimensionRecordFacts(snapshot.facts).filter((fact) =>
    dimensionFactIsCurrent(fact, snapshot) && fact.reviewStatus === "confirmed" && fact.dataStatus === "available").length;
}

export function dimensionRecordFacts(facts: readonly FactEnvelope[]): FactEnvelope[] {
  return latestFacts(facts).filter((fact) => !fact.field.startsWith("geometry.") && !isMaterialCoverageFact(fact));
}


export function pendingDimensionCount(snapshot: Pick<Snapshot, "facts" | "candidates">): number {
  return snapshot.candidates.filter((candidate) => candidate.reviewStatus !== "rejected" && candidate.reviewStatus !== "superseded")
    .reduce((count, candidate) => count + (candidate.structured?.kind === "measurementTranscription"
      ? candidate.structured.dimensions.filter((_, index) => !latestDimensionReview(snapshot.facts, candidate.id, index)).length : 0), 0);
}
