import { z } from "zod";
import type { ProjectHead } from "@gujian/application";
import type { FactEnvelope, ProjectGeometryObject, TypedParameter } from "@gujian/domain";

export const GeometryLengthFieldSchema = z.enum(["sizeX", "sizeY", "sizeZ", "radius", "height", "depth"]);
export type GeometryLengthField = z.infer<typeof GeometryLengthFieldSchema>;
export const GeometryDimensionBindingSchema = z.object({
  field: GeometryLengthFieldSchema,
  sourceFactRef: z.string().uuid(),
}).strict();
export type GeometryDimensionBinding = z.infer<typeof GeometryDimensionBindingSchema>;
export const GEOMETRY_LENGTH_LABELS: Record<GeometryLengthField, string> = {
  sizeX: "X 向长度", sizeY: "Y 向长度", sizeZ: "Z 向长度", radius: "半径", height: "圆柱长度", depth: "挤出长度",
};
export function geometryLengthFields(solid: ProjectGeometryObject["solid"]): GeometryLengthField[] {
  return solid.kind === "box" ? ["sizeX", "sizeY", "sizeZ"] : solid.kind === "cylinder" ? ["radius", "height"] : ["depth"];
}
export function dimensionLengthSourceProblem(snapshot: Pick<ProjectHead["snapshot"], "candidates"> & Partial<Pick<ProjectHead["snapshot"], "project">>, fact: FactEnvelope): string | null {
  const value = fact.value as { kind?: unknown; quantityKind?: unknown; candidateId?: unknown; rowIndex?: unknown } | null;
  if (!value || typeof value !== "object") return null;
  if (value.quantityKind !== undefined && value.quantityKind !== "length") return "相对标高不能用作构件长度。";
  if (value.kind !== "dimensionCandidateReview") return null;
  const candidate = snapshot.candidates.find((item) => item.id === value.candidateId && (!snapshot.project || item.projectId === snapshot.project.id));
  if (!candidate || candidate.structured?.kind !== "measurementTranscription") return "尺寸来源候选不存在或不属于本项目。";
  if (candidate.reviewStatus === "rejected" || candidate.reviewStatus === "superseded") return "尺寸来源候选已驳回或被替代。";
  if (typeof value.rowIndex !== "number" || !candidate.structured.dimensions[value.rowIndex]) return "尺寸来源标注不存在。";
  return null;
}
export function setGeometryLength(solid: ProjectGeometryObject["solid"], field: GeometryLengthField, value: string) {
  if (solid.kind === "box" && (field === "sizeX" || field === "sizeY" || field === "sizeZ")) solid[field] = value;
  else if (solid.kind === "cylinder" && (field === "radius" || field === "height")) solid[field] = value;
  else if (solid.kind === "extrudedProfile" && field === "depth") solid.depth = value;
  else throw new Error("GEOMETRY_DIMENSION_BINDING_INVALID:引用字段与构件形式不一致");
}
export function resolveGeometryDimensionBindings(
  head: ProjectHead,
  solidInput: ProjectGeometryObject["solid"],
  bindings: readonly GeometryDimensionBinding[],
) {
  const solid = structuredClone(solidInput);
  const factRefs: string[] = [];
  const evidenceRefs = new Set<string>();
  const parameters: TypedParameter[] = [];
  if (new Set(bindings.map((item) => item.field)).size !== bindings.length) throw new Error("GEOMETRY_DIMENSION_BINDING_INVALID:同一长度重复引用");
  for (const binding of bindings) {
    GeometryDimensionBindingSchema.parse(binding);
    const source = head.snapshot.facts.find((fact) => fact.id === binding.sourceFactRef);
    if (!source) throw new Error("GEOMETRY_DIMENSION_BINDING_INVALID:尺寸来源记录缺失");
    const latest = [...head.snapshot.facts].reverse().find((fact) => fact.subjectRef === source.subjectRef && fact.field === source.field)!;
    const problem = dimensionLengthSourceProblem(head.snapshot, latest);
    if (problem) throw new Error("GEOMETRY_DIMENSION_BINDING_INVALID:" + problem);
    const value = latest.value as { value?: unknown; unit?: unknown; disposition?: unknown } | null;
    if (latest.reviewStatus !== "confirmed" || latest.dataStatus !== "available"
      || !value || typeof value !== "object" || value.disposition === "reject" || value.unit !== "mm"
      || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value <= 0) {
      throw new Error("GEOMETRY_DIMENSION_BINDING_INVALID:引用尺寸已失效或不是可用的毫米长度");
    }
    if (!latest.evidenceRefs.length || latest.evidenceRefs.some((ref) => !head.snapshot.evidences.some((item) => item.id === ref && item.dataStatus === "available"))) {
      throw new Error("GEOMETRY_DIMENSION_BINDING_INVALID:引用尺寸的资料缺失或不可用");
    }
    // 数字转为十进制文本，避免科学计数法不符合已有精确数值契约。
    const exact = value.value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 });
    setGeometryLength(solid, binding.field, exact);
    factRefs.push(latest.id);
    latest.evidenceRefs.forEach((ref) => evidenceRefs.add(ref));
    parameters.push({
      id: crypto.randomUUID(), name: GEOMETRY_LENGTH_LABELS[binding.field], valueType: "length",
      exactValue: exact, unit: "mm", basis: latest.producer.producerType === "demo" ? "demo" : "human",
      factRefs: [latest.id], evidenceRefs: latest.evidenceRefs,
    });
  }
  return { solid, factRefs: [...new Set(factRefs)], evidenceRefs: [...evidenceRefs], parameters };
}


