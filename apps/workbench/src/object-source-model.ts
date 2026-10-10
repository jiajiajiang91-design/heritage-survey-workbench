import type { ProjectHead } from "@gujian/application";
import { GEOMETRY_LENGTH_LABELS } from "@gujian/infrastructure";
import { bindingDimension, componentEntries, LENGTH_FIELDS } from "./component-input";
import { latestFacts, reviewedDimension } from "./dimension-review";
import { validPreviewRegion } from "./preview-read-model";

type Snapshot = ProjectHead["snapshot"];
type GeometryObject = Snapshot["geometrySpecs"][number]["objects"][number];

export function objectSourceModel(snapshot: Snapshot, object: GeometryObject) {
  const entry = componentEntries(snapshot).find(({ input }) => input.stableKey === object.stableKey);
  const source = entry?.input.candidateSource;
  const candidate = source && snapshot.candidates.find((item) => item.id === source.candidateId);
  const row = candidate?.structured?.kind === "componentRecognition" ? candidate.structured.components[source!.rowIndex] : null;
  const fact = latestFacts(snapshot.facts).find((item) => item.field === "geometry.component." + object.stableKey);
  const evidenceIds = [...new Set([...object.evidenceRefs, ...(entry?.input.evidenceRefs ?? [])])];
  const references = new Set([object.id, object.stableKey, ...object.factRefs, ...evidenceIds, ...(fact ? [fact.id] : []), ...(source ? [source.candidateId] : [])]);
  const dimensions = (entry?.input.dimensionBindings ?? []).map((binding) => {
    const dimension = bindingDimension(snapshot, binding.sourceFactRef);
    const original = snapshot.facts.find((item) => item.id === binding.sourceFactRef);
    const latest = original && latestFacts(snapshot.facts).find((item) => item.subjectRef === original.subjectRef && item.field === original.field);
    const review = latest && reviewedDimension(latest);
    references.add(binding.sourceFactRef);
    if (latest) references.add(latest.id);
    if (review) references.add(review.candidateId);
    return { field: binding.field, label: GEOMETRY_LENGTH_LABELS[binding.field], dimension,
      name: dimension?.name ?? review?.name ?? "原标注",
      selection: review ? { candidateId: review.candidateId, rowIndex: review.rowIndex } : null };
  });
  const solid = object.solid;
  const modelLengths = LENGTH_FIELDS[solid.kind].map((field) => ({ label: GEOMETRY_LENGTH_LABELS[field], value: String((solid as unknown as Record<string, unknown>)[field]) }));
  const currentSolid = entry?.input.solid;
  const changedLengths = currentSolid ? LENGTH_FIELDS[currentSolid.kind].flatMap((field) => {
    if (entry?.input.dimensionBindings?.some((binding) => binding.field === field)) return [];
    const value = String((currentSolid as unknown as Record<string, unknown>)[field]);
    return value === String((solid as unknown as Record<string, unknown>)[field]) ? [] : [{ label: GEOMETRY_LENGTH_LABELS[field], value }];
  }) : [];
  return {
    source, evidenceIds, candidateEvidenceId: row?.evidenceRef ?? null,
    region: row && validPreviewRegion(row.region) ? row.region : null,
    problem: entry?.problem ?? null, dimensions, modelLengths, changedLengths,
    issues: snapshot.issues.filter((issue) => issue.status === "open" && [...issue.subjectRefs, ...issue.impactRefs].some((ref) => references.has(ref))),
  };
}
