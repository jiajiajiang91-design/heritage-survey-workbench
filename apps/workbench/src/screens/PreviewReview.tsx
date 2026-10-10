import { useEffect, useState } from "react";
import { PREVIEW_STATUS_LABELS, QUANTITY_LABELS, previewCsv, type PreviewReadModel, type PreviewRow } from "../preview-read-model";
import { EvidencePane } from "../shell/EvidencePane";
import type { ProjectHead } from "@gujian/application";
import type { EvidencePane as Pane } from "../workbench/useEvidencePane";
import { Alert, Button, EmptyState, Field, Tag } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import "./PreviewReview.css";
export interface PreviewReviewProps {
  snapshot: ProjectHead["snapshot"]; model: PreviewReadModel; pane: Pane; loading: boolean; error: string | null;
  onReview: (row: PreviewRow) => void; onReturn: () => void;
}
export function PreviewReview({ snapshot, model, pane, loading, error, onReview, onReturn }: PreviewReviewProps) {
  const [exportFile, setExportFile] = useState<{ text: string; url: string; name: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  useEffect(() => () => { if (exportFile) URL.revokeObjectURL(exportFile.url); }, [exportFile]);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = model.rows.filter((row) => filter === "all" || row.status === filter);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const aligned = selected?.evidenceId === pane.activeEvidenceId;
  const select = (row: PreviewRow) => { setSelectedId(row.id); pane.setActiveEvidenceId(row.evidenceId); pane.setImageSelection(null); };
  const exportList = (format: "csv" | "json") => {
    const text = format === "csv" ? previewCsv(model) : JSON.stringify({ project: snapshot.project.name, unit: "mm", purpose: "预览核对清单", qualification: "采用值为资料转写，候选尚需核对", ...model }, null, 2);
    setCopyStatus(null);
    setExportFile({ text, url: URL.createObjectURL(new Blob([text], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" })), name: snapshot.project.name + ".预览核对." + format });
  };
  const copyExport = async () => {
    if (!exportFile) return;
    try { await navigator.clipboard.writeText(exportFile.text); setCopyStatus("导出内容已复制。"); }
    catch { setCopyStatus("复制未完成，可展开内容手动选择复制。"); }
  };
  return <SplitPane className="sc-preview-layout" initialRatio={45} data={<>
    <div className="gj-pane-head"><span className="gj-pane-title">标注与构件 · {model.rows.length} 条</span></div>
    <p className="gj-pane-desc">先查看提取结果，再对照原件采用或修正。完整构件还需尺寸、位置与构造依据。</p>
    {loading && <p role="status">正在读取来源信息…</p>}{error && <Alert tone="warning">{error}</Alert>}
    <Field label="核对状态"><select aria-label="筛选核对状态" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部</option>{Object.entries(PREVIEW_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    {!rows.length ? <EmptyState>{model.rows.length ? "此状态下没有条目。" : "尚未取得候选。在资料清单选择可读输入并生成预览。"}</EmptyState> : <div className="gj-pane-list">{rows.map((row, index) => <button type="button" className="gj-list-card sc-preview-row" key={row.id} aria-label={"查看条目 " + (index + 1) + "：" + row.name} aria-current={selected?.id === row.id && aligned ? "true" : undefined} onClick={() => select(row)}>
      <div className="gj-list-card-head"><strong>{row.name}</strong><Tag tone={row.status === "adopted" || row.status === "corrected" || row.status === "prepared" ? "success" : "neutral"}>{PREVIEW_STATUS_LABELS[row.status]}</Tag></div>
      <span>{QUANTITY_LABELS[row.quantityKind]} · 原标注：{row.originalText}</span>
      {row.kind === "dimension" && <span>候选：{row.candidateMm === null ? "数值未知" : row.candidateMm + " mm"} · 最新采用：{row.adoptedMm === null ? "未采用" : row.adoptedMm + " mm"}</span>}
      <span className="gj-list-card-sub">{row.sourceName}{row.locationText ? " · " + row.locationText : ""}</span>
      {row.locationIssue && <span className="gj-list-card-sub">{row.locationIssue}</span>}
    </button>)}</div>}
    {!!model.missingInformation.length && <div className="gj-card gj-card--compact"><strong>待补充内容</strong><ul>{model.missingInformation.map((text) => <li key={text}>{text}</li>)}</ul></div>}
    <div className="gj-actions"><Button onClick={() => exportList("csv")} disabled={loading || !!error || !model.rows.length}>导出核对清单 CSV</Button><Button onClick={() => exportList("json")} disabled={loading || !!error || !model.rows.length}>导出来源说明 JSON</Button><Button onClick={onReturn}>返回资料清单</Button></div>
    {exportFile && <div className="gj-card gj-card--compact"><strong>已生成导出内容</strong><p>{exportFile.name}</p><div className="gj-actions"><a className="gj-btn gj-btn--secondary" href={exportFile.url} download={exportFile.name}>保存导出文件</a><Button onClick={() => void copyExport()}>复制导出内容</Button></div><details><summary>查看导出内容</summary><textarea aria-label="导出内容" readOnly value={exportFile.text} rows={6} /></details>{copyStatus && <p role="status">{copyStatus}</p>}</div>}
  </>} aside={<>
    {selected && <div className="gj-card gj-card--compact"><strong>{selected.name}</strong><p>{QUANTITY_LABELS[selected.quantityKind]} · {PREVIEW_STATUS_LABELS[selected.status]}</p><Button variant="primary" disabled={!selected.reviewable} onClick={() => onReview(selected)}>{selected.kind === "dimension" ? "核对或修正此标注" : selected.componentStableKey ? "编辑制作输入" : "完善构件参数"}</Button></div>}
    <EvidencePane evidences={snapshot.evidences} pane={pane} location={aligned ? selected?.region ?? null : null} description="图上区域来自候选。无区域时可临时框选原图，框选不写入尺寸记录。" emptyHint="选择左侧条目查看其来源。" caption={selected && <div className="ws-evidence-caption"><strong>{selected.name}</strong><p>{aligned ? selected.region ? "候选位置，待核对" : selected.locationIssue : "点击左侧条目切换到对应原件。"}</p>{selected.locationText && <p>{selected.locationText}</p>}{aligned && !selected.region && pane.imageSelection && <p>当前框选为临时定位，未保存。</p>}</div>} />
    {selected?.reason && <p className="gj-note">{selected.reason}</p>}
  </>} />;
}
