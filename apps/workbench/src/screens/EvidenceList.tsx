import { useRef, useState } from "react";
import type { ProjectHead } from "@gujian/application";

import { DATA_STATUS_LABELS, EVIDENCE_TYPE_LABELS, PARSE_STATUS_LABELS } from "../labels";
import { EvidencePane } from "../shell/EvidencePane";
import { Button, DataStatusTag, EmptyState } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";
import { EvidenceMissingDialog } from "./Dialogs";

// W02 资料清单（66:1661）：左卡资料文件（每份一张小卡：名称、状态标签、类型 · 解析状态），右卡证据预览。
// 缺失的资料照样登记不隐藏；状态词取数据状态四值（核心 PRD 附录 A.4）。
type Snapshot = ProjectHead["snapshot"];

export interface EvidenceListProps {
  snapshot: Snapshot;
  pane: EvidencePaneModel;
  readableDrawingCount: number;
  modelRunning: boolean;
  onUpload: (files: readonly File[]) => Promise<void>;
  onTranscribe: () => void;
  onGoToIssues: () => void;
}

export function EvidenceList({ snapshot, pane, readableDrawingCount, modelRunning, onUpload, onTranscribe, onGoToIssues }: EvidenceListProps) {
  const input = useRef<HTMLInputElement>(null);
  const [showMissing, setShowMissing] = useState(false);
  const missing = snapshot.evidences.filter((item) => item.dataStatus !== "available").length;
  const parseStatusOf = (evidenceId: string) => snapshot.parseRecords.find((record) => record.evidenceId === evidenceId)?.status ?? null;
  const summary = snapshot.evidences.length
    ? `${snapshot.evidences.length} 份资料${missing ? `，${missing} 份没有文件` : ""}。状态取数据状态四值，不另造词。`
    : "还没有资料。上传任务书、照片、测量记录或已有图纸，文件本体、证据记录和解析结果一起进入项目版本。";
  return (
    <>
    {showMissing && (
      <EvidenceMissingDialog
        registered={snapshot.evidences.map((item) => ({ id: item.id, title: item.title, dataStatus: item.dataStatus, parseStatus: parseStatusOf(item.id) }))}
        onClose={() => setShowMissing(false)}
        onGoToIssues={onGoToIssues}
        onUpload={() => input.current?.click()}
      />
    )}
    <SplitPane
      data={(
        <>
          {/* v4（66:1661）左卡只有标题、一句说明与资料卡列表；操作按钮按 W01/W09 的卡底形式放在列表之后 */}
          <div className="gj-pane-head">
            <span className="gj-pane-title">资料文件</span>
          </div>
          <p className="gj-pane-desc">{summary}</p>
          {snapshot.evidences.length ? (
            <div className="gj-pane-list">
              {snapshot.evidences.map((evidence) => {
                const parse = parseStatusOf(evidence.id);
                return (
                  <button type="button" className="gj-list-card" key={evidence.id} aria-current={pane.activeEvidenceId === evidence.id ? "true" : undefined}
                    onClick={() => pane.setActiveEvidenceId(evidence.id)}>
                    <div className="gj-list-card-head">
                      <span className="gj-list-card-title">{evidence.title}</span>
                      <DataStatusTag status={evidence.dataStatus} label={DATA_STATUS_LABELS[evidence.dataStatus] ?? evidence.dataStatus} />
                    </div>
                    <span className="gj-list-card-sub">
                      {EVIDENCE_TYPE_LABELS[evidence.evidenceType] ?? evidence.evidenceType} · {parse ? PARSE_STATUS_LABELS[parse] ?? parse : "尚未读取"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState>
              上传任务书、照片、测量记录或已有图纸。文件本体、证据记录和解析结果会一起进入项目版本。
            </EmptyState>
          )}
          <span className="gj-spacer" />
          <div className="gj-actions">
            {missing > 0 && <Button onClick={() => setShowMissing(true)}>处置缺失资料</Button>}
            {readableDrawingCount > 0 && <Button disabled={modelRunning} onClick={onTranscribe}>从图纸读尺寸</Button>}
            <Button variant="primary" onClick={() => input.current?.click()}>上传原始资料</Button>
            <input ref={input} className="sr-only" type="file" multiple
              onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void onUpload(files).finally(() => { event.target.value = ""; }); }} />
          </div>
        </>
      )}
      aside={(
        <EvidencePane
          evidences={snapshot.evidences}
          parseStatusOf={parseStatusOf}
          pane={pane}
          description="资料原件与构件的对应关系在后续步骤建立。"
          emptyHint="选择左侧资料查看原件。"
          detail={pane.activeEvidenceId ? undefined : null}
          caption={pane.activeEvidenceId ? undefined : null}
        />
      )}
    />
    </>
  );
}
