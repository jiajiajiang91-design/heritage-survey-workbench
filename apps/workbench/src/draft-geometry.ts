import type { ProjectCommandService, ProjectHead } from "@gujian/application";
import { ExactNumberSchema, type TranscribedDimension } from "@gujian/domain";
import { GEOMETRY_LENGTH_LABELS, type GeometryLengthField } from "@gujian/infrastructure";
import { bindingDimension, buildComponentInput, LENGTH_FIELDS, type ComponentDraft, type ComponentInput } from "./component-input";
import { buildDimensionReviewFacts, latestDimensionReview, reviewedDimension } from "./dimension-review";
import { evidenceReadability } from "./evidence-readability";
import { buildGeometryFacts } from "./geometry-fact-service";

type Snapshot = ProjectHead["snapshot"];
type Selection = { candidateId: string; rowIndex: number };
type ParameterSource = { field: GeometryLengthField; name: string; originalText: string; valueMm: string; evidenceId: string; locationText: string | null; kind: "candidate" | "adopted" | "manual"; selection?: Selection; region?: { x: number; y: number; width: number; height: number } | null };

function numberMm(text: string): number | null {
  if (!ExactNumberSchema.safeParse(text.trim()).success) return null;
  const [numerator, denominator = "1"] = text.trim().split("/");
  const value = Number(numerator) / Number(denominator);
  return Number.isFinite(value) ? value : null;
}
function rawRow(snapshot: Snapshot, selection: Selection): TranscribedDimension | null {
  const candidate = snapshot.candidates.find((item) => item.id === selection.candidateId && item.projectId === snapshot.project.id);
  return candidate?.structured?.kind === "measurementTranscription" && Number.isInteger(selection.rowIndex) && selection.rowIndex >= 0
    ? candidate.structured.dimensions[selection.rowIndex] ?? null : null;
}
function candidateProblem(snapshot: Snapshot, selection: Selection): string | null {
  const candidate = snapshot.candidates.find((item) => item.id === selection.candidateId && item.projectId === snapshot.project.id);
  const row = rawRow(snapshot, selection);
  if (!candidate || !row) return "候选长度不存在或不属于本项目，请重新选择。";
  if (candidate.reviewStatus === "rejected" || candidate.reviewStatus === "superseded") return "候选长度已驳回或被替代，请重新选择。";
  if (latestDimensionReview(snapshot.facts, candidate.id, selection.rowIndex)) return "候选条目已核对或驳回，请选择当前采用尺寸或其他候选。";
  if (row.quantityKind === "relativeElevation") return "相对标高不能用作构件长度。";
  if (!row.valueMm?.trim() || !Number.isFinite(Number(row.valueMm)) || Number(row.valueMm) <= 0) return "候选没有有效的正长度，不能推测数值。";
  if (!snapshot.evidences.some((item) => item.id === row.evidenceRef && item.projectId === snapshot.project.id && item.dataStatus === "available")
    || evidenceReadability(snapshot, row.evidenceRef).state !== "readable") return "候选原资料不可用或不可读，请重新核对来源。";
  return null;
}

export function candidateDimensions(snapshot: Snapshot): { selection: Selection; name: string; valueMm: string; evidenceId: string; originalText: string; locationText: string | null; quantityKind: string; region?: { x: number; y: number; width: number; height: number } | null }[] {
  return snapshot.candidates.flatMap((candidate) => candidate.structured?.kind === "measurementTranscription"
    ? candidate.structured.dimensions.flatMap((row, rowIndex) => {
      const selection = { candidateId: candidate.id, rowIndex };
      return candidateProblem(snapshot, selection) ? [] : [{ selection, name: row.partZh ?? "未定名尺寸", valueMm: row.valueMm!.trim(),
        evidenceId: row.evidenceRef, originalText: row.valueText, locationText: row.locationZh, quantityKind: row.quantityKind ?? "unspecified", ...(row.region ? { region: row.region } : {}) }];
    }) : []);
}

export function draftGeometryPreview(snapshot: Snapshot, draft: ComponentDraft, base?: ComponentInput): { component: ComponentInput | null; errors: Record<string, string>; sources: ParameterSource[] } {
  const errors: Record<string, string> = {};
  const sources: ParameterSource[] = [];
  const selectedValues = new Map<string, number | null>();
  const evidenceRefs = new Set(draft.evidenceRefs);
  if (draft.positionBasis !== "human" && draft.positionBasis !== "measured") errors.form = "待核对形体需要人工填写或实测的位置依据，规则和演示位置不能用于预览。";
  for (const field of LENGTH_FIELDS[draft.kind]) {
    const selection = draft.candidateBindings?.[field];
    const ref = draft.bindings[field];
    if (selection && ref) { errors[field] = "同一长度不能同时引用候选和已采用尺寸。"; continue; }
    if (selection) {
      const problem = candidateProblem(snapshot, selection);
      if (problem) { errors[field] = problem; continue; }
      const row = rawRow(snapshot, selection)!;
      const key = selection.candidateId + ":" + selection.rowIndex;
      const value = numberMm(draft.lengths[field]);
      if (selectedValues.has(key) && selectedValues.get(key) !== value) errors[field] = "同一候选绑定多个长度时，修正值必须一致。";
      selectedValues.set(key, value);
      evidenceRefs.add(row.evidenceRef);
      sources.push({ field, kind: "candidate", name: row.partZh ?? "未定名尺寸", originalText: row.valueText, valueMm: row.valueMm!, evidenceId: row.evidenceRef, locationText: row.locationZh, selection, ...(row.region ? { region: row.region } : {}) });
    } else if (ref) {
      const dimension = bindingDimension(snapshot, ref);
      if (!dimension) { errors[field] = "引用尺寸已失效或不再采用，请重新核对或解除引用。"; continue; }
      if (numberMm(draft.lengths[field]) !== dimension.valueMm) { errors[field] = "当前采用尺寸已变化，请重新选择尺寸后预览。"; continue; }
      const original = snapshot.facts.find((item) => item.id === dimension.factRef)!;
      const value = reviewedDimension(original)!;
      const evidenceId = dimension.evidenceRefs[0]!;
      if (evidenceReadability(snapshot, evidenceId).state !== "readable") { errors[field] = "采用尺寸的原资料不可读，请重新核对来源。"; continue; }
      dimension.evidenceRefs.forEach((id) => evidenceRefs.add(id));
      sources.push({ field, kind: "adopted", name: dimension.name, originalText: value.original.valueText, valueMm: String(dimension.valueMm), evidenceId, locationText: value.original.locationZh, ...(value.original.region ? { region: value.original.region } : {}) });
    } else sources.push({ field, kind: "manual", name: GEOMETRY_LENGTH_LABELS[field], originalText: draft.lengths[field], valueMm: draft.lengths[field], evidenceId: draft.evidenceRefs[0] ?? "", locationText: draft.sourceLocation || null });
  }
  const sourceEvidenceId = [...evidenceRefs][0] ?? "";
  for (const source of sources) if (source.kind === "manual" && !source.evidenceId) source.evidenceId = sourceEvidenceId;
  const built = buildComponentInput(snapshot, { ...draft, bindings: {}, evidenceRefs: [...evidenceRefs] }, base);
  const merged = { ...built.errors, ...errors };
  if (!built.value || Object.keys(merged).length) return { component: null, errors: merged, sources };
  const component = built.value;
  const bindings = LENGTH_FIELDS[draft.kind].flatMap((field) => draft.bindings[field] ? [{ field, sourceFactRef: draft.bindings[field]! }] : []);
  if (bindings.length || base?.dimensionBindings) component.dimensionBindings = bindings;
  return { component, errors: {}, sources };
}

export async function commitDraftGeometryComponent(input: {
  head: ProjectHead; draft: ComponentDraft; base?: ComponentInput | undefined; actorId: string; commands: ProjectCommandService;
  repository: { getProjectHead(projectId: string): Promise<ProjectHead | null> };
}): Promise<{ head: ProjectHead | null }> {
  const preview = draftGeometryPreview(input.head.snapshot, input.draft, input.base);
  if (!preview.component) throw new Error(Object.values(preview.errors).join("；"));
  const commandId = crypto.randomUUID();
  const groups = new Map<string, Map<number, { valueMm: string; name: string }>>();
  for (const source of preview.sources.filter((item) => item.kind === "candidate")) {
    const selection = source.selection!;
    const rows = groups.get(selection.candidateId) ?? new Map();
    const value = numberMm(input.draft.lengths[source.field])!;
    rows.set(selection.rowIndex, { valueMm: value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 }), name: source.name });
    groups.set(selection.candidateId, rows);
  }
  const dimensionFacts = [...groups].flatMap(([candidateId, rows]) => buildDimensionReviewFacts(input.head,
    input.head.snapshot.candidates.find((item) => item.id === candidateId)!,
    [...rows].map(([rowIndex, row]) => ({ rowIndex, ...row, disposition: "adopt" as const, quantityKind: "length" as const, checked: true, reason: input.draft.candidateReason ?? "" })), input.actorId, commandId));
  const virtualHead = { ...input.head, snapshot: { ...input.head.snapshot, facts: [...input.head.snapshot.facts, ...dimensionFacts] } };
  const component = preview.component;
  const candidateBindings = preview.sources.filter((item) => item.kind === "candidate").map((source) => ({
    field: source.field, sourceFactRef: latestDimensionReview(virtualHead.snapshot.facts, source.selection!.candidateId, source.selection!.rowIndex)!.id,
  }));
  if (candidateBindings.length) component.dimensionBindings = [...(component.dimensionBindings ?? []), ...candidateBindings];
  const geometryFacts = buildGeometryFacts({ head: virtualHead, actorId: input.actorId, commandId, values: { components: [component], interfaces: [] } });
  await input.commands.execute({ commandType: "CommitFacts", commandId, projectId: input.head.projectId, actorId: input.actorId,
    expectedRevisionId: input.head.revisionId, issuedAt: new Date().toISOString(), payload: { facts: [...dimensionFacts, ...geometryFacts] } });
  return { head: await input.repository.getProjectHead(input.head.projectId).catch(() => null) };
}
