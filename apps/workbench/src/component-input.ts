import type { ProjectHead } from "@gujian/application";
import { ExactNumberSchema } from "@gujian/domain";
import { candidateComponentKey, componentCandidateProblem, EvidenceGeometryComponentValueSchema, GEOMETRY_LENGTH_LABELS, type GeometryLengthField } from "@gujian/infrastructure";
import type { z } from "zod";
import { adoptedDimensions, latestFacts } from "./dimension-review";

export type ComponentInput = z.infer<typeof EvidenceGeometryComponentValueSchema>;
export type ComponentCandidateSelection = NonNullable<ComponentInput["candidateSource"]>;
type Snapshot = ProjectHead["snapshot"];
export type ComponentDraft = {
  candidateSource?: ComponentCandidateSelection;
  stableKey: string; name: string; componentType: string; material: string; sourceLocation: string;
  parentStableKey: string; kind: ComponentInput["solid"]["kind"]; axis: "x" | "y" | "z";
  positionBasis: NonNullable<ComponentInput["positionBasis"]>;
  lengths: Record<GeometryLengthField, string>;
  bindings: Partial<Record<GeometryLengthField, string>>;
  candidateBindings?: Partial<Record<GeometryLengthField, { candidateId: string; rowIndex: number }>>;
  candidateReason?: string;
  coordinates: [string, string, string]; profile: [string, string][];
  evidenceRefs: string[]; unknownDescription: string; requiredEvidence: string;
};
export const COMPONENT_TYPES = [
  ["wall", "墙体"], ["column", "柱"], ["beam", "梁"], ["floor", "楼板"],
  ["roof", "屋面"], ["door", "门"], ["window", "窗"], ["foundation", "基础"], ["opening", "洞口"],
] as const;
export const LENGTH_FIELDS: Record<ComponentInput["solid"]["kind"], GeometryLengthField[]> = {
  box: ["sizeX", "sizeY", "sizeZ"], cylinder: ["radius", "height"], extrudedProfile: ["depth"],
};
export function componentEntries(snapshot: Snapshot): { input: ComponentInput; problem: string | null }[] {
  return latestFacts(snapshot.facts).flatMap((fact) => {
    if (!fact.field.startsWith("geometry.component.") || fact.reviewStatus !== "confirmed" || fact.dataStatus !== "available") return [];
    const value = EvidenceGeometryComponentValueSchema.safeParse(fact.value);
    return value.success ? [{ input: value.data, problem: componentCandidateProblem(snapshot, value.data) }] : [];
  });
}
export function componentInputs(snapshot: Snapshot): ComponentInput[] {
  return componentEntries(snapshot).filter((entry) => !entry.problem).map((entry) => entry.input);
}
export function candidateComponent(snapshot: Snapshot, selection: ComponentCandidateSelection) {
  const candidate = snapshot.candidates.find((item) => item.id === selection.candidateId && item.projectId === snapshot.project.id);
  if (!candidate || candidate.structured?.kind !== "componentRecognition" || candidate.reviewStatus === "rejected" || candidate.reviewStatus === "superseded") return null;
  const row = candidate.structured.components[selection.rowIndex];
  return row && snapshot.evidences.some((item) => item.id === row.evidenceRef && item.dataStatus === "available") ? row : null;
}
export function candidateComponentInput(snapshot: Snapshot, selection: ComponentCandidateSelection): ComponentInput | undefined {
  return componentInputs(snapshot).find((input) => input.candidateSource?.candidateId === selection.candidateId && input.candidateSource.rowIndex === selection.rowIndex);
}
export function candidateComponentDraft(snapshot: Snapshot, selection: ComponentCandidateSelection): ComponentDraft | null {
  const row = candidateComponent(snapshot, selection);
  if (!row) return null;
  const existing = candidateComponentInput(snapshot, selection);
  if (existing) return componentDraft(existing);
  return { ...componentDraft(), candidateSource: selection, stableKey: candidateComponentKey(selection.candidateId, selection.rowIndex), name: row.nameZh,
    componentType: COMPONENT_TYPES.find(([value, label]) => row.categoryZh === value || row.categoryZh === label)?.[0] ?? "",
    evidenceRefs: [row.evidenceRef], sourceLocation: "原图候选区域（归一化）：" + JSON.stringify(row.region) };
}
export function componentDraft(base?: ComponentInput): ComponentDraft {
  const solid = base?.solid;
  return {
    ...(base?.candidateSource ? { candidateSource: base.candidateSource } : {}),
    stableKey: base?.stableKey ?? crypto.randomUUID(), name: base?.displayNameZh ?? "",
    componentType: base?.componentType ?? "", material: base?.materialCode === "unknown" ? "" : base?.materialCode ?? "",
    sourceLocation: base?.sourceLocation ?? "", parentStableKey: base?.parentStableKey ?? "",
    kind: solid?.kind ?? "box", axis: solid && solid.kind !== "box" ? solid.axis : "z",
    positionBasis: base?.positionBasis ?? "human",
    lengths: { sizeX: solid?.kind === "box" ? solid.sizeX : "", sizeY: solid?.kind === "box" ? solid.sizeY : "",
      sizeZ: solid?.kind === "box" ? solid.sizeZ : "", radius: solid?.kind === "cylinder" ? solid.radius : "",
      height: solid?.kind === "cylinder" ? solid.height : "", depth: solid?.kind === "extrudedProfile" ? solid.depth : "" },
    bindings: Object.fromEntries(base?.dimensionBindings?.map((item) => [item.field, item.sourceFactRef]) ?? []),
    coordinates: solid ? [...(solid.kind === "extrudedProfile" ? solid.originMm : solid.centerMm)].map((value) => value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 })) as [string, string, string] : ["", "", ""],
    profile: solid?.kind === "extrudedProfile" ? solid.profileMm.map((point) => point.map((value) => value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 })) as [string, string]) : [["", ""], ["", ""], ["", ""]],
    evidenceRefs: [...(base?.evidenceRefs ?? [])], unknownDescription: "", requiredEvidence: "",
  };
}
export function bindingDimension(snapshot: Snapshot, ref: string) {
  const original = snapshot.facts.find((fact) => fact.id === ref);
  const latest = original && latestFacts(snapshot.facts).find((fact) => fact.subjectRef === original.subjectRef && fact.field === original.field);
  return latest ? adoptedDimensions(snapshot).find((value) => value.factRef === latest.id) ?? null : null;
}
function numeric(text: string): number | null {
  if (!text.trim() || !ExactNumberSchema.safeParse(text.trim()).success) return null;
  const [numerator, denominator = "1"] = text.trim().split("/");
  const value = Number(numerator) / Number(denominator);
  return Number.isFinite(value) ? value : null;
}
function cross(a: number[], b: number[], c: number[]) {
  return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
}
export function profileError(points: [number, number][]): string | null {
  if (points.length < 3 || points.length > 2000) return "轮廓需要 3 至 2000 个点。";
  if (new Set(points.map((point) => point.join(","))).size !== points.length) return "轮廓点不能重复，末点无需重复首点。";
  const onSegment = (a: number[], b: number[], c: number[]) => cross(a, b, c) === 0 && c[0]! >= Math.min(a[0]!, b[0]!) && c[0]! <= Math.max(a[0]!, b[0]!) && c[1]! >= Math.min(a[1]!, b[1]!) && c[1]! <= Math.max(a[1]!, b[1]!);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    const a = points[i]!, b = points[(i + 1) % points.length]!, c = points[j]!, d = points[(j + 1) % points.length]!;
    if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
      || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return "轮廓边不能自交或重叠。";
  }
  const area = points.reduce((sum, point, index) => sum + point[0] * points[(index + 1) % points.length]![1] - points[(index + 1) % points.length]![0] * point[1], 0);
  return !Number.isFinite(area) || area === 0 ? "轮廓面积必须大于零。" : null;
}
export function buildComponentInput(snapshot: Snapshot, draft: ComponentDraft, base?: ComponentInput):
  { value: ComponentInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const [key, value, label, max] of [
    ["name", draft.name, "构件名称", 200], ["componentType", draft.componentType, "构件类型", 120],
    ["sourceLocation", draft.sourceLocation, "资料位置", 500],
  ] as const) if (!value.trim() || value.trim().length > max) errors[key] = label + "应为 1 至 " + max + " 字。";
  if (draft.material.trim().length > 120) errors.material = "材料应不超过 120 字。";
  const materialUnknown = !draft.material.trim() || /unknown|未知|不详/i.test(draft.material);
  const inputs = componentInputs(snapshot);
  if (snapshot.geometrySpecs.length && !snapshot.facts.some((fact) => fact.field.startsWith("geometry.component."))) errors.form = "现有展示模型没有原始构件输入。请在空项目中依资料制作，不能将展示模型反写为测绘记录。";
  let parent = draft.parentStableKey;
  const seen = new Set([draft.stableKey]);
  while (parent) {
    if (seen.has(parent)) { errors.parent = "所属构件不能形成循环。"; break; }
    seen.add(parent);
    const value = inputs.find((input) => input.stableKey === parent);
    if (!value) { errors.parent = "所属构件已不存在，请重新选择。"; break; }
    parent = value.parentStableKey ?? "";
  }
  const lengths: Record<string, string> = {};
  const bindings: NonNullable<ComponentInput["dimensionBindings"]> = [];
  for (const field of LENGTH_FIELDS[draft.kind]) {
    const ref = draft.bindings[field];
    if (ref) {
      const dimension = bindingDimension(snapshot, ref);
      if (!dimension) errors[field] = "引用尺寸已失效或不再采用，请重新核对或解除引用。";
      else {
        lengths[field] = dimension.valueMm.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 });
        bindings.push({ field, sourceFactRef: ref });
      }
    } else {
      const value = numeric(draft.lengths[field]);
      if (value === null || value <= 0) errors[field] = GEOMETRY_LENGTH_LABELS[field] + "应为大于 0 的有限毫米数值，可填写分数。";
      else lengths[field] = draft.lengths[field].trim();
    }
  }
  const coordinates = draft.coordinates.map((value, index) => {
    const number = numeric(value); if (number === null) errors["coordinate" + index] = "请填写有限的毫米坐标，可为 0 或负数。";
    return number ?? 0;
  }) as [number, number, number];
  const points = draft.profile.map((point, index) => point.map((value, axis) => {
    const number = numeric(value); if (number === null) errors["point" + index + "-" + axis] = "请填写有限的毫米坐标。";
    return number ?? 0;
  }) as [number, number]);
  if (draft.kind === "extrudedProfile") {
    const error = profileError(points); if (error) errors.profile = error;
  } else for (const key of Object.keys(errors)) if (key.startsWith("point")) delete errors[key];
  const evidenceRefs = [...new Set(draft.evidenceRefs)];
  if (!evidenceRefs.length || evidenceRefs.some((ref) => !snapshot.evidences.some((evidence) => evidence.id === ref && evidence.dataStatus === "available"))) errors.evidence = "请选择至少一份本项目可用资料，移除已失效的引用。";
  const unknowns = structuredClone(base?.unknowns ?? []);
  if (materialUnknown && !unknowns.some((item) => item.reasonCode === "material-unknown")) unknowns.push({
    reasonCode: "material-unknown", description: "构件材料尚未确认，需补充材料调查记录。", requiredEvidence: ["材料调查记录"],
    affectedStableKeys: [draft.stableKey], blocksProxyOutcome: false, blocksFormalEligibility: true,
  });
  if (draft.unknownDescription.trim() || draft.requiredEvidence.trim()) {
    if (!draft.unknownDescription.trim() || draft.unknownDescription.trim().length > 2000) errors.unknownDescription = "待确认说明应为 1 至 2000 字。";
    if (!draft.requiredEvidence.trim() || draft.requiredEvidence.trim().length > 300) errors.requiredEvidence = "请填写所需补充资料，最多 300 字。";
    if (!errors.unknownDescription && !errors.requiredEvidence) unknowns.push({
      reasonCode: "human-declared", description: draft.unknownDescription.trim(), requiredEvidence: [draft.requiredEvidence.trim()],
      affectedStableKeys: [draft.stableKey], blocksProxyOutcome: false, blocksFormalEligibility: true,
    });
  }
  if (Object.keys(errors).length) return { value: null, errors };
  const solid: ComponentInput["solid"] = draft.kind === "box" ? {
    kind: "box", sizeX: lengths.sizeX!, sizeY: lengths.sizeY!, sizeZ: lengths.sizeZ!, centerMm: coordinates,
  } : draft.kind === "cylinder" ? {
    kind: "cylinder", radius: lengths.radius!, height: lengths.height!, axis: draft.axis, centerMm: coordinates,
  } : { kind: "extrudedProfile", profileMm: points, depth: lengths.depth!, axis: draft.axis, originMm: coordinates };
  const parsed = EvidenceGeometryComponentValueSchema.safeParse({
    ...base, stableKey: draft.stableKey, displayNameZh: draft.name.trim(), componentType: draft.componentType.trim(),
    materialCode: materialUnknown ? "unknown" : draft.material.trim(), sourceLocation: draft.sourceLocation.trim(), parentStableKey: draft.parentStableKey || null,
    solid, positionBasis: draft.positionBasis, parameters: base?.parameters ?? [], unknowns, evidenceRefs,
    ...(bindings.length || base?.dimensionBindings ? { dimensionBindings: bindings } : {}),
    ...(draft.candidateSource ? { candidateSource: draft.candidateSource } : {}),
  });
  if (!parsed.success) return { value: null, errors: { form: "构件内容不符合现有格式，请检查输入长度及待确认条目数量。" } };
  const problem = componentCandidateProblem(snapshot, parsed.data);
  return problem ? { value: null, errors: { form: problem } } : { value: parsed.data, errors: {} };
}


