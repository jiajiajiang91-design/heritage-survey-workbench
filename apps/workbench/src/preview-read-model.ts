import type { ProjectHead } from "@gujian/application";
import type { AssetRecord, ModelCandidate } from "@gujian/domain";
import { latestDimensionReview, reviewedDimension } from "./dimension-review";
import { evidenceReadability } from "./evidence-readability";
import type { NormalizedRect } from "./EvidenceMarquee";
import { candidateComponentInput } from "./component-input";

type Snapshot = ProjectHead["snapshot"];
export const PREVIEW_STATUS_LABELS = { pending: "待核对", adopted: "已采用", corrected: "已修正", prepared: "制作输入已保存", rejected: "已驳回", inactive: "已被替代", unavailable: "依据不可用", confirmed: "整体已确认" } as const;
export type PreviewStatus = keyof typeof PREVIEW_STATUS_LABELS;
export const QUANTITY_LABELS = { length: "长度", relativeElevation: "相对标高", unspecified: "类型待核对", component: "构件" } as const;
export interface PreviewRow {
  id: string; candidateId: string; rowIndex: number; kind: "dimension" | "component";
  reviewable: boolean; name: string; originalText: string; candidateMm: string | null; adoptedMm: number | null;
  quantityKind: keyof typeof QUANTITY_LABELS; status: PreviewStatus; reason: string | null;
  evidenceId: string; sourceName: string; sourceHash: string | null; sourceAvailable: boolean;
  locationText: string | null; region: NormalizedRect | null; locationIssue: string | null;
  componentStableKey?: string;
}
export interface PreviewReadModel { rows: PreviewRow[]; missingInformation: string[] }
export function validPreviewRegion(region: NormalizedRect | undefined): region is NormalizedRect {
  return !!region && [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
    && region.x + region.width <= 1 && region.y + region.height <= 1;
}
export function previewInputErrors(snapshot: Snapshot, ids: readonly string[]): string[] {
  const task = snapshot.taskDefinitions.filter((item) => item.confirmedAt !== null).at(-1);
  const errors: string[] = [];
  if (!task?.productionSetup || !snapshot.buildings.some((item) => item.id === task.productionSetup!.buildingId)) errors.push("请在任务卡保存建筑、制作目的、输出单位与目标成果。");
  if (!ids.length) errors.push("请至少勾选一份可读资料。");
  else if (ids.some((id) => evidenceReadability(snapshot, id).state !== "readable")) errors.push("所选资料尚不可读，请完成读取或调整选择。");
  return errors;
}
export function buildPreviewReadModel(snapshot: Snapshot, assets: readonly AssetRecord[]): PreviewReadModel {
  const rows: PreviewRow[] = [];
  const missing = new Set<string>();
  const source = (candidate: ModelCandidate, index: number, evidenceId: string, region: NormalizedRect | undefined) => {
    const evidence = snapshot.evidences.find((item) => item.id === evidenceId);
    const asset = assets.find((item) => item.id === evidence?.assetId && item.projectId === snapshot.project.id);
    const sourceAvailable = evidence?.dataStatus === "available" && asset?.contentStatus === "available";
    const image = evidence && evidenceReadability(snapshot, evidence.id).kind === "image";
    const locationIssue = !sourceAvailable ? "原件缺失或不可用" : !region ? "未提供图上区域" : !validPreviewRegion(region) ? "图上区域越界或无效" : !image ? "当前资料不是可定位图像" : null;
    return { id: candidate.id + ":" + index, candidateId: candidate.id, rowIndex: index, evidenceId,
      sourceName: asset?.fileName ?? evidence?.title ?? "来源资料缺失", sourceHash: asset?.sha256 ?? null,
      reviewable: candidate.reviewStatus !== "rejected" && candidate.reviewStatus !== "superseded",
      sourceAvailable: !!sourceAvailable, region: locationIssue ? null : region!, locationIssue };
  };
  for (const candidate of snapshot.candidates) {
    const output = candidate.structured;
    if (!output || output.kind === "evidenceSummary") continue;
    if (candidate.reviewStatus !== "rejected" && candidate.reviewStatus !== "superseded") output.missingInformation.forEach((text) => missing.add(text));
    if (output.kind === "measurementTranscription") output.dimensions.forEach((row, index) => {
      const basis = source(candidate, index, row.evidenceRef, row.region);
      const fact = latestDimensionReview(snapshot.facts, candidate.id, index);
      const review = fact ? reviewedDimension(fact) : null;
      const availableReview = review?.disposition === "adopt" && fact?.reviewStatus === "confirmed" && fact.dataStatus === "available";
      const status: PreviewStatus = candidate.reviewStatus === "superseded" ? "inactive"
        : candidate.reviewStatus === "rejected" || review?.disposition === "reject" ? "rejected"
        : !basis.sourceAvailable || (review?.disposition === "adopt" && !availableReview) ? "unavailable"
        : availableReview ? review.corrected ? "corrected" : "adopted" : "pending";
      rows.push({ ...basis, kind: "dimension", name: review?.name ?? row.partZh ?? "部位待核对",
        originalText: row.valueText, candidateMm: row.valueMm, adoptedMm: status === "adopted" || status === "corrected" ? review!.value : null,
        quantityKind: review?.quantityKind ?? (review ? "length" : row.quantityKind ?? "unspecified"), status,
        reason: review?.reason || row.noteZh, locationText: row.locationZh });
    });
    else output.components.forEach((row, index) => {
      const basis = source(candidate, index, row.evidenceRef, row.region);
      const input = candidateComponentInput(snapshot, { candidateId: candidate.id, rowIndex: index });
      rows.push({ ...basis, kind: "component", name: input?.displayNameZh ?? row.nameZh, originalText: row.nameZh, candidateMm: null, adoptedMm: null,
        ...(input ? { componentStableKey: input.stableKey } : {}),
        quantityKind: "component", status: candidate.reviewStatus === "superseded" ? "inactive" : candidate.reviewStatus === "rejected" ? "rejected" : !basis.sourceAvailable ? "unavailable" : input ? "prepared" : candidate.reviewStatus === "confirmed" ? "confirmed" : "pending",
        reason: row.noteZh, locationText: null });
      if (!input) missing.add(row.nameZh + "：制作参数与三维位置尚未齐备，原图区域不用于三维定位。");
    });
  }
  if (rows.some((row) => row.kind === "dimension")) missing.add("完整构件的尺寸与位置尚未齐备；标注清单不直接生成三维模型。");
  return { rows, missingInformation: [...missing] };
}
export function previewCsv(model: PreviewReadModel): string {
  const quote = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
  const lines: unknown[][] = [["条目标识", "名称", "类型", "状态", "原标注", "候选值(mm)", "最新采用值(mm)", "来源文件", "来源SHA256", "文字位置", "图上区域", "位置缺项", "核对说明"]];
  model.rows.forEach((row) => lines.push([row.id, row.name, QUANTITY_LABELS[row.quantityKind], PREVIEW_STATUS_LABELS[row.status], row.originalText, row.candidateMm, row.adoptedMm, row.sourceName, row.sourceHash, row.locationText, row.region ? JSON.stringify(row.region) : "", row.locationIssue, row.reason]));
  lines.push([], ["缺项"], ...model.missingInformation.map((text) => [text]), [], ["说明", "候选须核对后采用；采用值来自资料转写，不代表现场实测。"]);
  return "\uFEFF" + lines.map((line) => line.map(quote).join(",")).join("\r\n");
}
