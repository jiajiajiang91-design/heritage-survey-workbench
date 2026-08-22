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

// 图纸预览地址。只取前六张，对象 URL 在依赖变化或卸载时统一撤销，
// 图纸样式与成组图纸两个视图共用同一份，不各自再建一套。
export function useDrawingPreviews(drawingArtifacts: readonly ArtifactRecord[]): readonly DrawingPreview[] {
  const [previews, setPreviews] = useState<readonly DrawingPreview[]>([]);
  const key = drawingArtifacts.map((artifact) => artifact.id).join("|");
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const load = async () => {
      const previewArtifacts = drawingArtifacts.filter((artifact): artifact is ArtifactRecord & { kind: "svg" | "pdf" } => artifact.kind === "svg" || artifact.kind === "pdf");
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
