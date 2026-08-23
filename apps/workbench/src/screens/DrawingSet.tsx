import { useState } from "react";
import type { ArtifactRecord, CheckRun } from "@gujian/domain";

import { cadPhaseLabel } from "../labels";
import { LongTask } from "../LongTask";
import { DrawingLimitationNote, QualificationChip } from "../QualificationNotice";
import { Button, EmptyState, Tag } from "../ui";
import { FileViewer } from "../ui/FileViewer";
import { useAssetBlob } from "../workbench/useAssetUrls";
import type { DrawingPreview } from "../workbench/useAssetUrls";
import "./SheetStyle.css";

// 成组图纸：十九屏没有对应屏，按 W08 的形式规则做（左设置卡 300、右预览卡，同一套行距与字阶）。
// 左卡列本次检查覆盖的图纸成果，右卡按张预览；每条线都由当前三维模型剖切或投影得到（PRD F13）。
export interface DrawingSetProps {
  artifacts: readonly ArtifactRecord[];
  previews: readonly DrawingPreview[];
  latestCheckRun: CheckRun | null;
  hasGeometry: boolean;
  hasTask: boolean;
  generating: boolean;
  showTask: boolean;
  progressPhase: string | null;
  cancelling: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  onDownload: (artifact: ArtifactRecord) => void;
}

const KIND_LABELS: Record<string, string> = { svg: "矢量预览", pdf: "PDF", dxf: "DXF", glb: "GLB", ifc: "IFC", json: "记录", viewGeometry: "视图线稿" };

export function DrawingSet({ artifacts, previews, latestCheckRun, hasGeometry, hasTask, generating, showTask, progressPhase, cancelling, onGenerate, onCancel, onDownload }: DrawingSetProps) {
  const drawings = artifacts.filter((artifact) => ["svg", "pdf", "dxf"].includes(artifact.kind));
  const others = artifacts.filter((artifact) => !["svg", "pdf", "dxf"].includes(artifact.kind));
  // 右卡看选中的那份；默认第一张图幅的 SVG（实施单元 09：DXF 与 PDF 都在页内看）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = drawings.find((item) => item.id === selectedId) ?? drawings.find((item) => item.kind === "svg") ?? drawings[0] ?? null;
  const selectedAsset = useAssetBlob(selected?.assetId ?? null);
  return (
    <div className="sc-sheet">
      <section className="sc-sheet-settings">
        <div className="gj-pane-head">
          <span className="gj-pane-title">成组图纸</span>
          {artifacts.length > 0 && <QualificationChip />}
        </div>
        {showTask && <LongTask labelZh={`正在生成成组图纸：${cadPhaseLabel(progressPhase)}`} onCancel={onCancel} cancelling={cancelling} />}
        {artifacts.length ? (
          <div className="sc-sheet-list">
            {drawings.map((artifact) => (
              <button type="button" className="sc-sheet-row sc-sheet-row--file" key={artifact.id} aria-current={selected?.id === artifact.id ? "true" : undefined} onClick={() => setSelectedId(artifact.id)} title="在右侧查看这份图纸">
                <span className="sc-sheet-label">{KIND_LABELS[artifact.kind] ?? artifact.kind}</span>
                <span className="sc-sheet-value">{artifact.fileName}<small>{Math.round(artifact.byteLength / 1024)} KB</small></span>
              </button>
            ))}
            {others.length > 0 && <span className="gj-note">另有 {others.length} 项模型与记录成果随本次检查一并收录。</span>}
          </div>
        ) : (
          <EmptyState>{hasGeometry ? "还没有图纸。按任务要求出图后，图纸会同时导出 DXF、PDF 和预览图。" : "先生成三维模型，再按任务要求出图。"}</EmptyState>
        )}
        {artifacts.length > 0 && <DrawingLimitationNote />}
        {latestCheckRun && (
          <div className="sc-sheet-checks">
            <span className="gj-text-label">检查结果</span>
            {latestCheckRun.results.map((item) => (
              <div className="sc-sheet-check" key={item.code}>
                <Tag tone={item.outcome === "passed" ? "success" : "danger"}>{item.outcome === "passed" ? "通过" : "不通过"}</Tag>
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        )}
        <span className="gj-spacer" />
        <div className="gj-actions">
          <Button variant="primary" loadable busy={generating} disabled={!hasGeometry || !hasTask || generating} onClick={onGenerate}>按成果目录生成</Button>
        </div>
      </section>
      <section className="sc-sheet-preview">
        <div className="sc-sheet-preview-head">
          <span className="gj-pane-title" title={selected?.fileName}>{selected ? `${KIND_LABELS[selected.kind] ?? selected.kind} · ${selected.fileName.replace(/\.(svg|pdf|dxf)$/i, "")}` : "图面预览"}</span>
          <span className="gj-spacer" />
          {previews.length > 0 && <Tag>{drawings.length} 份</Tag>}
          {selected && <Button variant="text" compact onClick={() => onDownload(selected)}>下载</Button>}
        </div>
        {selected ? (
          selectedAsset
            ? <FileViewer blob={selectedAsset.blob} mimeType={selectedAsset.mimeType} fileName={selectedAsset.fileName} height={476} onDownload={() => onDownload(selected)} />
            : <div className="sc-sheet-figure sc-sheet-figure--empty">正在读取图纸</div>
        ) : (
          <div className="sc-sheet-figure sc-sheet-figure--empty">出图后按张显示预览。</div>
        )}
      </section>
    </div>
  );
}
