import { PanelRightClose, PanelRightOpen } from "lucide-react";

import { ChatPanel } from "../assistant/ChatPanel";
import { LongTask } from "../LongTask";
import { Button } from "../ui";
import { journeyStages, stageLabel, type StageId } from "../view-registry";
import type { AssistantBridge } from "../workbench/useAssistantBridge";
import type { EvidencePane } from "../workbench/useEvidencePane";
import type { Jobs } from "../workbench/useJobs";

// 助手栏（V3/Assistant Panel 36:14）：头部标题与状态、任务状态块、消息流、输入区。
// 对话本体是 ChatPanel，这里只给它外壳与上下文块。
export interface AssistantPanelProps {
  hasProject: boolean;
  activeStage: StageId;
  assistant: AssistantBridge;
  jobs: Jobs;
  evidence: EvidencePane;
  collapsed: boolean;
  onExpand: () => void;
  // 窄屏下面板浮在中栏上，头部给一个收起按钮；宽屏按 v4 不显示
  onCollapse: () => void;
  selectedEntityName: string | null;
  modelConfigured: boolean;
}

export function AssistantPanel({ hasProject, activeStage, assistant, jobs, evidence, collapsed, onExpand, onCollapse, selectedEntityName, modelConfigured }: AssistantPanelProps) {
  if (collapsed) {
    return (
      <aside className="ws-assistant-collapsed">
        <Button icon onClick={onExpand} aria-label="展开助手面板"><PanelRightOpen size={16} /></Button>
      </aside>
    );
  }
  const stageIndex = journeyStages.findIndex((stage) => (stage.views as readonly string[]).includes(activeStage));
  const busy = jobs.modelRunning || jobs.geometryRunning || jobs.drawingRunning;
  const stateText = !hasProject ? "未进入项目" : busy ? "处理中" : !modelConfigured ? "识别未连接" : "等待确认";
  const dotClass = !hasProject || !modelConfigured ? "ws-assistant-dot ws-assistant-dot--off" : busy ? "ws-assistant-dot ws-assistant-dot--busy" : "ws-assistant-dot";
  const { pendingProposal, provenance } = assistant;
  return (
    <aside className="ws-assistant" aria-label="AI 助手">
      <div className="ws-assistant-head">
        <h2>AI 助手</h2>
        <span className="ws-assistant-state"><i className={dotClass} aria-hidden="true" />{stateText}</span>
        <span className="ws-assistant-close"><Button icon onClick={onCollapse} aria-label="收起助手面板"><PanelRightClose size={16} /></Button></span>
      </div>
      <div className="ws-assistant-body">
        {hasProject && stageIndex >= 0 && (
          <div className="ws-assistant-task">
            <span className="ws-assistant-task-step">当前任务 · {stageIndex + 1} / {journeyStages.length}</span>
            <span className="ws-assistant-task-name">{stageLabel(activeStage)}</span>
            <div className="ws-assistant-progress" role="progressbar" aria-valuemin={0} aria-valuemax={journeyStages.length} aria-valuenow={stageIndex + 1} aria-label="任务阶段进度">
              <i style={{ "--progress": `${((stageIndex + 1) / journeyStages.length) * 100}%` } as React.CSSProperties} />
            </div>
          </div>
        )}
        <p className="ws-assistant-status" role="status">{assistant.currentStatusText}</p>
        {/* 消息流之后的附加内容：待采纳建议、识别进度、长任务、来源关系、两条说明 */}
        {(() => {
          const extra = (
            <>
              {pendingProposal && (
                <div className="ws-assistant-proposal">
                  <strong>修改建议待确认</strong>
                  <p>{pendingProposal.subjectName} 的 {pendingProposal.field}：{pendingProposal.oldValueText} → {pendingProposal.newValueText}</p>
                  <small className="gj-note">{pendingProposal.rationaleZh}</small>
                  {pendingProposal.warnings.map((warning) => <p className="gj-note" key={warning}>{warning}</p>)}
                  <div className="gj-actions">
                    <Button variant="primary" compact onClick={() => void assistant.adoptProposal()}>采纳生效</Button>
                    <Button compact onClick={assistant.rejectProposal}>拒绝</Button>
                  </div>
                </div>
              )}
              {jobs.modelProgress && (
                <div className="ws-assistant-run">
                  <strong>助手正在识别</strong>
                  <p>{jobs.modelProgress.streamedText || "正在建立受控运行……"}</p>
                  {jobs.modelRunning && <Button compact onClick={jobs.cancelModel}>停止识别</Button>}
                </div>
              )}
              {jobs.showGeometryTask && <LongTask labelZh="正在生成三维模型" onCancel={() => void jobs.cancelGeometry()} cancelling={jobs.cadCancelling} />}
              {jobs.showDrawingTask && <LongTask labelZh="正在生成成组图纸" onCancel={() => void jobs.cancelDrawings()} cancelling={jobs.drawingCancelling} />}
              {provenance && (
                <section className="ws-provenance" aria-label="来源关系">
                  <span className="ws-assistant-section-title">{selectedEntityName ? `${selectedEntityName} 的来源` : "本项目的来源"}</span>
                  {provenance.nodes.map((node) => (
                    <div className="ws-provenance-row" key={node.key} data-status={node.status}>
                      <strong>{node.label}</strong>
                      <span>{node.count ? `${node.count} 项已关联` : "尚无"}</span>
                    </div>
                  ))}
                  <span className="gj-note">{provenance.unknownCount} 项待确认 · {provenance.formalBlockerCount} 项影响正式交付</span>
                </section>
              )}
              <div className="ws-assistant-notes">
                <span>助手的识别结果先进入待确认区，确认后才写入项目</span>
                <span>资料原件保存在本机，不会上传</span>
              </div>
            </>
          );
          return hasProject ? (
            <ChatPanel
              client={assistant.assistantChatClient}
              buildSnapshot={assistant.buildAssistantSnapshot}
              onClientOp={assistant.handleAssistantClientOp}
              selection={assistant.chatSelection}
              onClearSelection={() => evidence.setImageSelection(null)}
              extra={extra}
            />
          ) : <div className="assistant-chat-scroll">{extra}</div>;
        })()}
      </div>
    </aside>
  );
}
