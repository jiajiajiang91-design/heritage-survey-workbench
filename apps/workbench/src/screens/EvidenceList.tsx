import { useRef, useState } from "react";
import type { ProjectHead } from "@gujian/application";
import { EVIDENCE_TYPE_LABELS } from "../labels";
import { evidenceReadability, latestParse } from "../evidence-readability";
import { previewInputErrors } from "../preview-read-model";
import { requiredMaterialHint } from "../production-task";
import { MaterialCoverage, MaterialCoverageEditor } from "./MaterialCoverage";
import type { CoverageEntry } from "../material-coverage";
import { EvidencePane } from "../shell/EvidencePane";
import { Button, EmptyState, Field } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";

type Snapshot = ProjectHead["snapshot"];
export interface EvidenceListProps {
  snapshot: Snapshot; pane: EvidencePaneModel; readableDrawingCount: number; modelRunning: boolean;
  onUpload: (files: readonly File[], level?: "required" | "recommended" | "additional") => Promise<void>;
  onRetry: (id: string) => Promise<void>; processingEvidenceId: string | null; uploading: boolean;
  selectedIds: readonly string[]; onSelectionChange: (ids: readonly string[]) => void;
  onViewPreview?: () => void; onEditTask?: () => void;
  onTranscribe: (ids: readonly string[]) => void; onGoToIssues: () => void;
  onSaveCoverage?: (id: string, entries: CoverageEntry[]) => Promise<boolean>;
}
const STATE_LABELS = { readable: "可读", unsupported: "未自动读取", failed: "失败" };
const LEVEL_LABELS = { required: "必需资料", recommended: "建议资料", additional: "额外补充" };
export function EvidenceList({ snapshot, pane, readableDrawingCount, modelRunning, onUpload, onRetry, processingEvidenceId, uploading, onTranscribe, selectedIds, onSelectionChange, onViewPreview, onEditTask, onSaveCoverage }: EvidenceListProps) {
  const input = useRef<HTMLInputElement>(null);
  const [level, setLevel] = useState<"required" | "recommended" | "additional">("required");
  const readableIds = snapshot.evidences.filter((item) => evidenceReadability(snapshot, item.id).state === "readable").map((item) => item.id);
  const readable = readableIds.length;
  const targets = snapshot.taskDefinitions.find((item) => item.confirmedAt !== null)?.productionSetup?.targets ?? ["model"];
  const inputErrors = previewInputErrors(snapshot, selectedIds);
  const hasPreview = snapshot.candidates.some((item) => item.structured?.kind === "measurementTranscription" || item.structured?.kind === "componentRecognition");
  const busy = uploading || Boolean(processingEvidenceId);
  return <SplitPane data={<>
    <div className="gj-pane-head"><span className="gj-pane-title">资料准备</span></div>
    <p className="gj-pane-desc">{snapshot.evidences.length ? snapshot.evidences.length + " 份资料，" + readable + " 份可读。可读表示能够提供图像或文字输入，内容仍需核对。" : "添加原始资料后逐份检查读取结果。至少一份可读资料可进入提取。"}</p>
    {inputErrors.length > 0 && <p className="gj-pane-desc">{inputErrors.join(" ")}{onEditTask && !snapshot.taskDefinitions.some((item) => item.confirmedAt && item.productionSetup) && <Button compact onClick={onEditTask}>补充任务设置</Button>}</p>}
    <div className="gj-actions">
      {readable > 0 && <Button variant="primary" disabled={modelRunning || busy || inputErrors.length > 0} onClick={() => onTranscribe(selectedIds)}>{modelRunning ? "正在生成预览" : "生成预览"}</Button>}
      {hasPreview && onViewPreview && <Button onClick={onViewPreview}>查看已有预览</Button>}
      <Button variant={readable ? "secondary" : "primary"} disabled={busy} onClick={() => input.current?.click()}>{uploading ? "正在保存与处理资料" : "上传原始资料"}</Button>
      <input ref={input} aria-label="上传原始资料文件" className="sr-only" type="file" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void onUpload(files, level); }} />
    </div>
    <Field label="上传资料层级"><select aria-label="资料层级" value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as typeof level)}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    <details className="gj-card gj-card--compact"><summary>查看资料要求与覆盖情况</summary>
      <p><strong>必需资料</strong> · {requiredMaterialHint(targets)}</p>
      <p><strong>建议资料</strong> · 其他方向照片、历史图纸与说明。</p>
      <p><strong>额外补充</strong> · 详图、节点照片、局部尺寸。</p>
    <MaterialCoverage snapshot={snapshot} onSelect={pane.setActiveEvidenceId} />
    </details>
    {snapshot.evidences.length ? <div className="gj-pane-list">{snapshot.evidences.map((evidence) => {
      const result = evidenceReadability(snapshot, evidence.id); const processing = evidence.id === processingEvidenceId;
      return <div className="gj-card gj-card--compact" key={evidence.id}>
        <button type="button" className="gj-list-card" aria-current={pane.activeEvidenceId === evidence.id ? "true" : undefined} onClick={() => pane.setActiveEvidenceId(evidence.id)}>
          <div className="gj-list-card-head"><span className="gj-list-card-title">{evidence.title}</span><span>{processing ? "正在处理" : STATE_LABELS[result.state]}</span></div>
          <span className="gj-list-card-sub">{evidence.preparationLevel ? LEVEL_LABELS[evidence.preparationLevel] : "未登记层级"} · {EVIDENCE_TYPE_LABELS[evidence.evidenceType]}</span>
        </button>
        {result.state === "readable" && <label><input type="checkbox" aria-label={"用于本次读取 " + evidence.title} checked={selectedIds.includes(evidence.id)} disabled={busy || modelRunning} onChange={(event) => onSelectionChange(event.target.checked ? [...selectedIds, evidence.id] : selectedIds.filter((id) => id !== evidence.id))} /> 用于本次读取</label>}
        {result.detail && <p className="gj-pane-desc">{result.detail}</p>}
        {evidence.imageDerivative && <p className="gj-pane-desc">原图与 PNG 派生图：{evidence.imageDerivative.sourceSizePixels.join(" × ")} px，坐标相同。</p>}
        {result.state === "readable" && onSaveCoverage && <MaterialCoverageEditor key={evidence.id} snapshot={snapshot} evidenceId={evidence.id} onSave={onSaveCoverage} onOpen={() => pane.setActiveEvidenceId(evidence.id)} />}
        {evidence.dataStatus === "available" && result.state !== "readable" && <Button disabled={busy} onClick={() => void onRetry(evidence.id)}>重试读取 {evidence.title}</Button>}
      </div>;
    })}</div> : <EmptyState>还没有资料。支持文字、有文字层的 PDF、JPEG、PNG、WebP 和单帧 TIFF；其他格式保留原件并说明未支持。</EmptyState>}
  </>} aside={<EvidencePane evidences={snapshot.evidences} parseStatusOf={(id) => latestParse(snapshot, id)?.status ?? null} pane={pane} description="对照可读原件或同坐标派生图，核对后再采用候选。" emptyHint="选择左侧资料查看。" />} />;
}
