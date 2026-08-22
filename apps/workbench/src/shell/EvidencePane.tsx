import type { ReactNode } from "react";

import { EvidenceMarquee } from "../EvidenceMarquee";
import { Button } from "../ui";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";

// 证据半区（05 表 2、图 1）：显示选中资料原件，数据与证据并置，图片可框选。
// 形态照 v4 各工作屏的右半区（如 W04 66:1783 的照片证据区）：标题、图、说明、引用行。
export interface EvidencePaneProps {
  evidences: readonly { id: string; title: string; assetId: string; evidenceType: string; dataStatus: string }[];
  pane: EvidencePaneModel;
  title?: string;
  emptyHint: string;
  // 证据下方的说明区，由各屏按自己的对象给（构件说明、稳定键等）
  caption?: ReactNode;
}

export function EvidencePane({ evidences, pane, title = "资料原件", emptyHint, caption }: EvidencePaneProps) {
  const { activeEvidenceId, setActiveEvidenceId, evidencePreview, imageSelection, setImageSelection, downloadEvidence } = pane;
  const active = evidences.find((item) => item.id === activeEvidenceId) ?? null;
  return (
    <div className="ws-evidence">
      <div className="ws-evidence-head">
        <strong>{title}</strong>
        {evidencePreview && <small title={evidencePreview.fileName}>{evidencePreview.fileName}</small>}
      </div>
      {evidences.length > 1 && (
        <div className="ws-evidence-switch" role="tablist" aria-label="切换资料">
          {evidences.map((evidence) => (
            <button key={evidence.id} type="button" role="tab" aria-current={activeEvidenceId === evidence.id ? "true" : undefined} title={evidence.title}
              onClick={() => setActiveEvidenceId(evidence.id)}>{evidence.title}</button>
          ))}
        </div>
      )}
      <div className="ws-evidence-body">
        {evidencePreview ? (
          evidencePreview.mimeType.startsWith("image/")
            ? (
              <div className="ws-evidence-figure">
                <EvidenceMarquee
                  src={evidencePreview.url}
                  alt={`${evidencePreview.fileName} 原件`}
                  selection={imageSelection?.evidenceId === evidencePreview.evidenceId ? imageSelection.rectNormalized : null}
                  onSelect={(rect) => setImageSelection(rect ? { evidenceId: evidencePreview.evidenceId, rectNormalized: rect } : null)}
                />
              </div>
            )
            : evidencePreview.mimeType === "application/pdf"
              ? <object data={evidencePreview.url} type="application/pdf" aria-label={`${evidencePreview.fileName} 原件`} />
              : (
                <div className="ws-evidence-placeholder">
                  <span>该类型的文件无法在页内显示。</span>
                  <Button variant="text" onClick={() => { if (active) void downloadEvidence(active.assetId); }}>下载原文件核对</Button>
                </div>
              )
        ) : (
          <div className="ws-evidence-placeholder">
            {active && active.dataStatus !== "available"
              ? `${active.title}：原件未随项目提供，无法显示。`
              : evidences.length ? emptyHint : "还没有资料。上传后可在此对照原件核对数据。"}
          </div>
        )}
        {caption}
      </div>
    </div>
  );
}
