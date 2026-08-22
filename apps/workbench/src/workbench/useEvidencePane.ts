import { useEffect, useState } from "react";

import type { NormalizedRect } from "../EvidenceMarquee";
import { projectRepository } from "../workbench";
import { triggerDownload } from "./download";
import type { ProjectSession } from "./useProjectSession";

export interface EvidencePreview {
  evidenceId: string;
  url: string;
  mimeType: string;
  fileName: string;
}

export interface ImageSelection {
  evidenceId: string;
  rectNormalized: NormalizedRect;
}

// 证据半区（05 界面与交互形态 §三）：中栏右半区显示选中资料原件，数据与证据并置。
export function useEvidencePane(session: ProjectSession) {
  const { selected } = session;
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreview | null>(null);
  // 证据图片上的框选。换资料就清掉：位置只对它所属的那张图有意义。
  const [imageSelection, setImageSelection] = useState<ImageSelection | null>(null);

  // 换项目或退出项目时清掉选中资料，上一项目的资料 id 对新项目没有意义
  useEffect(() => { setActiveEvidenceId(null); }, [selected?.projectId]);

  // 选中资料后读取原件生成预览地址；切换或卸载时释放
  useEffect(() => {
    setImageSelection(null);
    if (!activeEvidenceId) { setEvidencePreview(null); return; }
    let cancelled = false;
    let created: string | null = null;
    const evidence = selected?.snapshot.evidences.find((item) => item.id === activeEvidenceId);
    const load = async () => {
      if (!evidence) return;
      const stored = await projectRepository.getAsset(evidence.assetId);
      if (cancelled) return;
      created = URL.createObjectURL(stored.content);
      setEvidencePreview({ evidenceId: evidence.id, url: created, mimeType: stored.record.mimeType, fileName: stored.record.fileName });
    };
    void load().catch(() => setEvidencePreview(null));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [activeEvidenceId, selected?.projectId]);

  const downloadEvidence = async (assetId: string) => {
    const asset = await projectRepository.getAsset(assetId);
    triggerDownload(asset.content, asset.record.fileName);
  };

  const activeEvidenceTitle = selected?.snapshot.evidences.find((item) => item.id === activeEvidenceId)?.title ?? null;

  return {
    activeEvidenceId, setActiveEvidenceId, activeEvidenceTitle, evidencePreview,
    imageSelection, setImageSelection, downloadEvidence,
  };
}

export type EvidencePane = ReturnType<typeof useEvidencePane>;
