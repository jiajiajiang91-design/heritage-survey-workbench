import { useRef } from "react";
import type { ProjectHead } from "@gujian/application";

import { DATA_STATUS_LABELS, EVIDENCE_TYPE_LABELS, PARSE_STATUS_LABELS } from "../labels";
import { EvidencePane } from "../shell/EvidencePane";
import { Button, DataStatusTag, EmptyState } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";

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
}

export function EvidenceList({ snapshot, pane, readableDrawingCount, modelRunning, onUpload, onTranscribe }: EvidenceListProps) {
  const input = useRef<HTMLInputElement>(null);
  const missing = snapshot.evidences.filter((item) => item.dataStatus !== "available").length;
  const parseStatusOf = (evidenceId: string) => snapshot.parseRecords.find((record) => record.evidenceId === evidenceId)?.status ?? null;
  const summary = snapshot.evidences.length
    ? `${snapshot.evidences.length} 份资料${missing ? `，${missing} 份没有文件` : ""}。状态取数据状态四值，不另造词。`
    : "还没有资料。上传任务书、照片、测量记录或已有图纸，文件本体、证据记录和解析结果一起进入项目版本。";
  return (
    <SplitPane
      data={(
        <>
          <div className="gj-pane-head">
            <span className="gj-pane-title">资料文件</span>
            <div className="gj-actions">
              {readableDrawingCount > 0 && <Button compact disabled={modelRunning} onClick={onTranscribe}>从图纸读尺寸</Button>}
              <Button variant="primary" compact onClick={() => input.current?.click()}>上传原始资料</Button>
              <input ref={input} className="sr-only" type="file" multiple
                onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void onUpload(files).finally(() => { event.target.value = ""; }); }} />
            </div>
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
            <EmptyState action={<Button variant="primary" compact onClick={() => input.current?.click()}>上传原始资料</Button>}>
              上传任务书、照片、测量记录或已有图纸。文件本体、证据记录和解析结果会一起进入项目版本。
            </EmptyState>
          )}
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
  );
}
