import { TaskArtifactRequirementsSchema, type TaskArtifactRequirements } from "@gujian/domain";

export interface TaskSetupValues {
  taskName: string;
  scope: string[];
  regulationRefs: string[];
  deliverables: string[];
  artifactRequirements: TaskArtifactRequirements;
}
type Sheet = TaskArtifactRequirements["sheets"][number];
type View = TaskArtifactRequirements["views"][number];
type Text3 = [string, string, string];
type Text4 = [string, string, string, string];
export type SheetDraft = Omit<Sheet, "pageMm"> & { pageMm: [string, string] };
export type ViewDraft = Omit<View, "scaleDenominator" | "viewportRectMm" | "direction" | "right" | "up" | "sectionPlane" | "cropBoundsMm"> & {
  scaleDenominator: string;
  viewportRectMm: Text4;
  direction: Text3;
  right: Text3;
  up: Text3;
  sectionPlane?: { normal: Text3; offsetMm: string };
  cropBoundsMm?: Text4;
};
export interface RequirementsDraft {
  titleZh: string;
  revisionLabel: string;
  geometryTargetRoles: string[];
  sheets: SheetDraft[];
  views: ViewDraft[];
}
export interface ReferenceOption { value: string; label: string }
export interface RequirementReferences { components: ReferenceOption[]; evidences: ReferenceOption[] }
export type FieldErrors = Record<string, string>;
export const splitLines = (value: string): string[] => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const text3 = (v: readonly number[]): Text3 => [String(v[0]), String(v[1]), String(v[2])];
const text4 = (v: readonly number[]): Text4 => [...text3(v), String(v[3])];
const numeric = (v: string): number => v.trim() ? Number(v) : NaN;
const number3 = (v: Text3): [number, number, number] => [numeric(v[0]), numeric(v[1]), numeric(v[2])];
const number4 = (v: Text4): [number, number, number, number] => [...number3([v[0], v[1], v[2]]), numeric(v[3])];

export function newSheet(): SheetDraft {
  return { key: `sheet-${crypto.randomUUID()}`, drawingNumber: "", displayLabelZh: "", pageMm: ["420", "297"] };
}
export function newView(sheet?: SheetDraft): ViewDraft {
  return {
    key: `view-${crypto.randomUUID()}`, displayLabelZh: "", drawingRef: "", kind: "floorPlan", scaleDenominator: "100",
    sheetKey: sheet?.key ?? "", viewportRectMm: ["20", "40", String(Math.max(1, numeric(sheet?.pageMm[0] ?? "420") - 40)), String(Math.max(1, numeric(sheet?.pageMm[1] ?? "297") - 80))],
    direction: ["0", "0", "1"], right: ["1", "0", "0"], up: ["0", "1", "0"], targetStableKeys: [], sourceEvidenceRefs: [],
  };
}
export function requirementsDraft(value?: TaskArtifactRequirements): RequirementsDraft {
  if (!value) {
    const sheet = newSheet();
    return { titleZh: "", revisionLabel: "P1", geometryTargetRoles: [], sheets: [sheet], views: [newView(sheet)] };
  }
  return {
    titleZh: value.titleZh, revisionLabel: value.revisionLabel, geometryTargetRoles: [...value.geometryTargetRoles],
    sheets: value.sheets.map((s) => ({ ...s, pageMm: [String(s.pageMm[0]), String(s.pageMm[1])] })),
    views: value.views.map(({ sectionPlane, cropBoundsMm, ...v }) => ({
      ...v, scaleDenominator: String(v.scaleDenominator), viewportRectMm: text4(v.viewportRectMm),
      direction: text3(v.direction), right: text3(v.right), up: text3(v.up),
      targetStableKeys: [...v.targetStableKeys], sourceEvidenceRefs: [...v.sourceEvidenceRefs],
      ...(sectionPlane ? { sectionPlane: { normal: text3(sectionPlane.normal), offsetMm: String(sectionPlane.offsetMm) } } : {}),
      ...(cropBoundsMm ? { cropBoundsMm: text4(cropBoundsMm) } : {}),
    })),
  };
}
export function readRequirementsDraft(draft: RequirementsDraft): TaskArtifactRequirements {
  return {
    titleZh: draft.titleZh, revisionLabel: draft.revisionLabel, geometryTargetRoles: draft.geometryTargetRoles.filter((role) => role.trim()),
    sheets: draft.sheets.map((s) => ({ ...s, pageMm: [numeric(s.pageMm[0]), numeric(s.pageMm[1])] })),
    views: draft.views.map(({ sectionPlane, cropBoundsMm, ...v }) => ({
      ...v, scaleDenominator: numeric(v.scaleDenominator), viewportRectMm: number4(v.viewportRectMm),
      direction: number3(v.direction), right: number3(v.right), up: number3(v.up),
      ...(sectionPlane ? { sectionPlane: { normal: number3(sectionPlane.normal), offsetMm: numeric(sectionPlane.offsetMm) } } : {}),
      ...(cropBoundsMm ? { cropBoundsMm: number4(cropBoundsMm) } : {}),
    })),
  };
}

const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i]!, 0);
const norm = (a: number[]) => Math.hypot(...a);
const perpendicular = (a: number[], b: number[]) => Math.abs(dot(a, b)) <= 1e-6 * norm(a) * norm(b);
// 与 sheet_writer.py 的固定图签（221 × 30 mm）、5 mm 页边及3 mm间距一致，坐标从页底起算。
export function overlapsTitleBlock(rect: readonly number[], pageWidth: number): boolean {
  return rect[1]! < 38 && rect[0]! + rect[2]! > pageWidth - 226 && rect[0]! < pageWidth - 5;
}

export function outsidePrintableArea(rect: readonly number[], page: readonly number[]): boolean {
  return rect[0]! < 10 || rect[1]! < 20 || rect[0]! + rect[2]! > page[0]! - 10 || rect[1]! + rect[3]! > page[1]! - 35;
}
export function validateRequirements(draft: RequirementsDraft, refs?: RequirementReferences): { value: TaskArtifactRequirements | null; errors: FieldErrors } {
  const value = readRequirementsDraft(draft);
  const errors: FieldErrors = {};
  const result = TaskArtifactRequirementsSchema.safeParse(value);
  if (!result.success) for (const issue of result.error.issues) {
    errors[issue.path.join(".") || "requirements"] = "请填写符合要求的值；数字须有效，必填项不能为空。";
  }
  if (!value.titleZh.trim()) errors.titleZh = "请填写图纸标题。";
  if (!value.revisionLabel.trim()) errors.revisionLabel = "请填写修订标记。";
  if (!value.geometryTargetRoles.length || value.geometryTargetRoles.some((role) => !role.trim())) errors.geometryTargetRoles = "请至少填写一个出图构件类型。";
  value.sheets.forEach((s, i) => {
    if (!s.drawingNumber.trim()) errors[`sheets.${i}.drawingNumber`] = "请填写图号。";
    if (!s.displayLabelZh.trim()) errors[`sheets.${i}.displayLabelZh`] = "请填写图幅名称。";
  });
  value.views.forEach((v, i) => {
    const path = `views.${i}`;
    if (!v.displayLabelZh.trim()) errors[`${path}.displayLabelZh`] = "请填写视图名称。";
    if (!v.drawingRef.trim()) errors[`${path}.drawingRef`] = "请填写视图编号。";
    if (!Number.isInteger(v.scaleDenominator) || v.scaleDenominator <= 0) errors[`${path}.scaleDenominator`] = "比例分母须为正整数。";
    const sheet = value.sheets.find((s) => s.key === v.sheetKey);
    if (!sheet) errors[`${path}.sheetKey`] = "请选择现有图幅。";
    const [x, y, width, height] = v.viewportRectMm;
    if (!v.viewportRectMm.every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || (sheet && (x + width > sheet.pageMm[0] || y + height > sheet.pageMm[1]))) {
      errors[`${path}.viewportRectMm`] = "视口宽高须大于零，且必须位于所选图幅内。";
    } else if (sheet && overlapsTitleBlock(v.viewportRectMm, sheet.pageMm[0])) {
      errors[`${path}.viewportRectMm`] = "视口与右下图签重叠，请将视口 Y 调整为至少 38 mm，或移至图签左侧。";
    } else if (sheet && outsidePrintableArea(v.viewportRectMm, sheet.pageMm)) {
      errors[`${path}.viewportRectMm`] = "视口超出可打印区域，请留出左右各 10 mm、下侧 20 mm、上侧 35 mm；移动视口后需相应缩小宽高。";
    }
    const vectors = [v.direction, v.right, v.up];
    if (vectors.some((a) => !a.every(Number.isFinite) || Math.abs(norm(a) - 1) > 1e-6) || !perpendicular(v.direction, v.right) || !perpendicular(v.direction, v.up) || !perpendicular(v.right, v.up)) {
      errors[`${path}.orientation`] = "观察、向右和向上方向须为长度为 1 且相互垂直的向量。";
    }
    if (["transverseSection", "longitudinalSection", "detail"].includes(v.kind) && !v.sectionPlane) errors[`${path}.sectionPlane`] = "该图种需要明确剖切位置和法向。";
    if (v.sectionPlane && (!v.sectionPlane.normal.every(Number.isFinite) || Math.abs(norm(v.sectionPlane.normal) - 1) > 1e-6 || !Number.isFinite(v.sectionPlane.offsetMm))) errors[`${path}.sectionPlane`] = "请填写有效的剖切位置与长度为 1 的法向。";
    if (v.kind === "detail" || v.cropBoundsMm) {
      const crop = v.cropBoundsMm;
      if (!crop || !crop.every(Number.isFinite) || crop[2] <= crop[0] || crop[3] <= crop[1]) errors[`${path}.cropBoundsMm`] = "裁切最大值须大于最小值，详图必须填写裁切范围。";
    }
    if (v.kind === "detail" && !v.targetStableKeys.length) errors[`${path}.targetStableKeys`] = "详图至少选择一个构件。";
    if (v.kind === "detail" && !v.sourceEvidenceRefs.length) errors[`${path}.sourceEvidenceRefs`] = "详图至少选择一份依据资料。";
    if (refs) {
      if (v.targetStableKeys.some((key) => !refs.components.some((o) => o.value === key))) errors[`${path}.targetStableKeys`] = "包含当前项目中找不到的构件，请重新选择或明确移除。";
      if (v.sourceEvidenceRefs.some((key) => !refs.evidences.some((o) => o.value === key))) errors[`${path}.sourceEvidenceRefs`] = "包含当前项目中找不到的资料，请重新选择或明确移除。";
    }
  });
  return { value: Object.keys(errors).length ? null : value, errors };
}

export function describeRequirementChanges(before: RequirementsDraft, after: RequirementsDraft): string[] {
  const changes: string[] = [];
  if (before.titleZh !== after.titleZh) changes.push("图纸标题已修改");
  if (before.revisionLabel !== after.revisionLabel) changes.push("修订标记已修改");
  if (JSON.stringify(before.geometryTargetRoles) !== JSON.stringify(after.geometryTargetRoles)) changes.push("出图构件范围已修改");
  for (const [field, label] of [["sheets", "图幅"], ["views", "视图"]] as const) {
    const old = new Map<string, SheetDraft | ViewDraft>(before[field].map((item) => [item.key, item]));
    const next = new Set(after[field].map((item) => item.key));
    for (const item of after[field]) {
      if (!old.has(item.key)) changes.push(`新增${label}：${item.displayLabelZh || "尚未命名"}`);
      else if (JSON.stringify(old.get(item.key)) !== JSON.stringify(item)) changes.push(`修改${label}：${item.displayLabelZh || "尚未命名"}`);
    }
    for (const item of before[field]) if (!next.has(item.key)) changes.push(`移除${label}：${item.displayLabelZh}`);
  }
  return changes;
}


