import type { ReactNode } from "react";

import { EvidenceMarquee } from "../EvidenceMarquee";
import { DATA_STATUS_LABELS, EVIDENCE_TYPE_LABELS, PARSE_STATUS_LABELS } from "../labels";
import { Button, DataStatusTag, InfoRow, Tag } from "../ui";
import { FileViewer } from "../ui/FileViewer";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";

// 证据半区（v4 各工作屏右侧的 Evidence pane，如 66:1698）：标题、说明、图、题注、信息行。
// 数据与证据并置（05 表 2），图片可框选。每屏的说明与题注由调用方按自己的对象给。
export interface EvidenceItem {
  id: string;
  title: string;
  assetId: string;
  evidenceType: string;
  dataStatus: string;
  rightsDeclaration: string | null;
  intendedUse: string | null;
}

export interface EvidencePaneProps {
  evidences: readonly EvidenceItem[];
  parseStatusOf?: (evidenceId: string) => string | null;
  pane: EvidencePaneModel;
  title?: string;
  description?: string;
  emptyHint: string;
  // 图下方的题注区，由各屏按自己的对象给（构件说明、稳定键等）；不给时显示资料本身的题注
  caption?: ReactNode;
  // 题注下方的信息行，不给时显示资料的来源与文件状态
  detail?: ReactNode;
  // v4 各屏的证据卡都没有切换下拉，看哪份资料由左侧列表、事实行或构件卡决定；只在没有别的入口时打开
  switcher?: boolean;
}

export function EvidencePane({ evidences, parseStatusOf, pane, title = "资料原件", description, emptyHint, caption, detail, switcher = false }: EvidencePaneProps) {
  const { activeEvidenceId, setActiveEvidenceId, evidencePreview, imageSelection, setImageSelection, downloadEvidence } = pane;
  const active = evidences.find((item) => item.id === activeEvidenceId) ?? null;
  const parseStatus = active && parseStatusOf ? parseStatusOf(active.id) : null;
  return (
    <>
      <div className="gj-pane-head">
        <span className="gj-pane-title">{title}</span>
        {switcher && evidences.length > 1 && (
          <select className="ws-evidence-select" aria-label="切换资料" value={activeEvidenceId ?? ""} onChange={(event) => setActiveEvidenceId(event.target.value || null)}>
            <option value="">选择资料</option>
            {evidences.map((evidence) => <option key={evidence.id} value={evidence.id}>{evidence.title}</option>)}
          </select>
        )}
      </div>
      {description && <p className="gj-pane-desc">{description}</p>}
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
          : (
            <FileViewer
              blob={evidencePreview.url}
              mimeType={evidencePreview.mimeType}
              fileName={evidencePreview.fileName}
              height={238}
              onDownload={() => { if (active) void downloadEvidence(active.assetId); }}
            />
          )
      ) : (
        <div className="ws-evidence-placeholder">
          {active && active.dataStatus !== "available"
            ? `${active.title}：原件未随项目提供，无法显示。`
            : evidences.length ? emptyHint : "还没有资料。上传后可在此对照原件核对数据。"}
        </div>
      )}
      {caption ?? (active && (
        <div className="ws-evidence-caption">
          <strong>{active.title}</strong>
          {(active.rightsDeclaration || active.intendedUse) && <p>{active.rightsDeclaration ?? active.intendedUse}</p>}
        </div>
      ))}
      {detail ?? (active && (
        <div className="gj-card gj-card--compact">
          <InfoRow
            label="资料类型"
            value={EVIDENCE_TYPE_LABELS[active.evidenceType] ?? active.evidenceType}
            trailing={parseStatus ? <Tag>{PARSE_STATUS_LABELS[parseStatus] ?? parseStatus}</Tag> : undefined}
          />
          <InfoRow
            label="文件状态"
            value={active.dataStatus === "available" ? "原件已随项目提供" : "原件未随项目提供"}
            trailing={<DataStatusTag status={active.dataStatus} label={DATA_STATUS_LABELS[active.dataStatus] ?? active.dataStatus} />}
          />
          {active.dataStatus === "available" && (
            <div className="gj-actions"><Button variant="text" compact onClick={() => void downloadEvidence(active.assetId)}>下载原文件</Button></div>
          )}
        </div>
      ))}
    </>
  );
}
