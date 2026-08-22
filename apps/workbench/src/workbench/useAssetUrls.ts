import { useEffect, useState } from "react";
import type { ArtifactRecord, GeometryRevision } from "@gujian/domain";

import { projectRepository } from "../workbench";

// 当前几何版本的 GLB 内容。版本一换就重读，读不到就显示为空。
export function useGeometryBlob(geometryRevision: GeometryRevision | null): Blob | null {
  const [geometryBlob, setGeometryBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!geometryRevision) return setGeometryBlob(null);
      const glb = geometryRevision.assets.find((asset) => asset.kind === "glb");
      if (!glb) return setGeometryBlob(null);
      const stored = await projectRepository.getAsset(glb.assetId);
      if (!cancelled) setGeometryBlob(stored.content);
    };
    void load().catch(() => setGeometryBlob(null));
    return () => { cancelled = true; };
  }, [geometryRevision?.id]);
  return geometryBlob;
}

export interface DrawingPreview {
  id: string;
  kind: "svg" | "pdf";
  label: string;
  url: string;
}

// 预览页签名：单张图幅用图幅号，合并的整套 PDF 显示为“全套 PDF”，不露文件名后缀
export function previewLabel(item: { label: string; kind: string }): string {
  const stem = item.label.replace(/\.(svg|pdf)$/i, "");
  return item.kind === "pdf" && /^drawings$/i.test(stem) ? "全套 PDF" : stem;
}

// 图幅纸张：A 系列按 ISO 216 尺寸识别，识别不了就写毫米
export function pageLabel(pageMm: readonly number[]): string {
  const [w, h] = [Math.max(pageMm[0] ?? 0, pageMm[1] ?? 0), Math.min(pageMm[0] ?? 0, pageMm[1] ?? 0)];
  const sizes: [number, number, string][] = [[1189, 841, "A0"], [841, 594, "A1"], [594, 420, "A2"], [420, 297, "A3"], [297, 210, "A4"]];
  const hit = sizes.find(([a, b]) => a === w && b === h);
  return hit ? hit[2] : `${pageMm[0]}×${pageMm[1]}`;
}

// 预览卡的标题、比例与题注（v4 66:2905 与 66:2949）：图幅号加该图幅上的图名，比例取这些视图，题注写图种比例、图幅纸张与版本。
// 任务书的成果要求（TaskArtifactRequirements，视图按 sheetKey 挂图幅）与出图要求矩阵（viewIds）两种形状都接。
// 合并 PDF 没有对应图幅时标题用页签名，题注列全部视图。
export interface PreviewRequirements {
  revisionLabel: string;
  views: readonly { id?: string; key?: string; sheetKey?: string; displayLabelZh: string; scaleDenominator: number }[];
  sheets: readonly { id?: string; key?: string; viewIds?: readonly string[]; drawingNumber: string; displayLabelZh: string; pageMm: readonly number[] }[];
}

export function describePreview(preview: DrawingPreview | null, requirements: PreviewRequirements | null): { title: string; scales: string[]; caption: string | null } {
  if (!preview) return { title: "图面预览", scales: [], caption: null };
  const views = requirements?.views ?? [];
  const sheets = requirements?.sheets ?? [];
  const stem = preview.label.replace(/\.(svg|pdf)$/i, "");
  const sheet = sheets.find((item) => item.drawingNumber === stem) ?? null;
  const onSheet = (view: PreviewRequirements["views"][number]) => sheet !== null && ((sheet.key !== undefined && view.sheetKey === sheet.key) || (sheet.viewIds !== undefined && view.id !== undefined && sheet.viewIds.includes(view.id)));
  const shown = sheet ? views.filter(onSheet) : views;
  const title = sheet ? `${sheet.drawingNumber} ${shown.map((view) => view.displayLabelZh).join("、") || sheet.displayLabelZh}` : previewLabel(preview);
  const scales = [...new Set(shown.map((view) => `1:${view.scaleDenominator}`))];
  const caption = requirements
    ? [
        shown.map((view) => `${view.displayLabelZh} 1:${view.scaleDenominator}`).join("，"),
        `图幅 ${(sheet ? [sheet] : sheets).map((item) => `${item.drawingNumber} 为 ${pageLabel(item.pageMm)} ${item.pageMm[0]}×${item.pageMm[1]}`).join("，")}`,
        `版本 ${requirements.revisionLabel}`,
      ].join(" · ")
    : null;
  return { title, scales, caption };
}

// 图纸预览地址。只取前六张，对象 URL 在依赖变化或卸载时统一撤销，
// 图纸样式与成组图纸两个视图共用同一份，不各自再建一套。
export function useDrawingPreviews(drawingArtifacts: readonly ArtifactRecord[]): readonly DrawingPreview[] {
  const [previews, setPreviews] = useState<readonly DrawingPreview[]>([]);
  const key = drawingArtifacts.map((artifact) => artifact.id).join("|");
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const load = async () => {
      // 单张图幅的 SVG 在前、合并 PDF 在后：默认预览一张图幅（v4 66:2896 的预览就是单张图），PDF 作最后一个页签
      const previewArtifacts = drawingArtifacts
        .filter((artifact): artifact is ArtifactRecord & { kind: "svg" | "pdf" } => artifact.kind === "svg" || artifact.kind === "pdf")
        .sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "svg" ? -1 : 1));
      const resolved = await Promise.all(previewArtifacts.slice(0, 6).map(async (artifact) => {
        const stored = await projectRepository.getAsset(artifact.assetId);
        const url = URL.createObjectURL(stored.content);
        urls.push(url);
        return { id: artifact.id, kind: artifact.kind, label: artifact.fileName, url };
      }));
      if (!cancelled) setPreviews(resolved);
    };
    void load().catch(() => setPreviews([]));
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [key]);
  return previews;
}
