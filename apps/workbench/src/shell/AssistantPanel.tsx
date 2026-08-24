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
  modelConfigured: boolean;
}

export function AssistantPanel({ hasProject, activeStage, assistant, jobs, evidence, collapsed, onExpand, onCollapse, modelConfigured }: AssistantPanelProps) {
  const stageIndex = journeyStages.findIndex((stage) => (stage.views as readonly string[]).includes(activeStage));
  const busy = jobs.modelRunning || jobs.geometryRunning || jobs.drawingRunning;
  const stateText = !hasProject ? "未进入项目" : busy ? "处理中" : !modelConfigured ? "识别未连接" : "在线";
  const dotClass = !hasProject || !modelConfigured ? "ws-assistant-dot ws-assistant-dot--off" : busy ? "ws-assistant-dot ws-assistant-dot--busy" : "ws-assistant-dot";
  const { pendingProposal } = assistant;
  // 收起时只藏不卸：对话记录在 ChatPanel 的组件状态里，卸载再装载会把问答清空
  return (
    <>
    {collapsed && (
      <aside className="ws-assistant-collapsed">
        <Button icon onClick={onExpand} aria-label="展开助手面板"><PanelRightOpen size={16} /></Button>
      </aside>
    )}
    <aside className="ws-assistant" aria-label="AI 助手" hidden={collapsed}>
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
        {/* 消息流之前是助手建议（36:27），之后是待采纳建议、识别进度与长任务；说明与来源关系不在面板里（实施单元 09） */}
        {(() => {
          const { suggestion } = assistant;
          const lead = hasProject ? (
            <div className="ws-assistant-suggest" role="status">
              <span className="ws-assistant-section-title">助手建议</span>
              {suggestion.text ? (
                <div className="assistant-msg assistant-msg-assistant">
                  <p>{suggestion.text}</p>
                  {suggestion.basis && <small>依据：{suggestion.basis}</small>}
                </div>
              ) : (
                <div className="assistant-msg assistant-msg-assistant">
                  <p>{suggestion.loading ? "正在根据项目现状整理建议" : modelConfigured ? assistant.currentStatusText : "模型服务未连接，建议暂不可用；你仍可以用下方输入切换视图或发起操作。"}</p>
                </div>
              )}
            </div>
          ) : null;
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
              {jobs.showDrawingTask && <LongTask labelZh="正在生成图纸" onCancel={() => void jobs.cancelDrawings()} cancelling={jobs.drawingCancelling} />}
            </>
          );
          return hasProject ? (
            <ChatPanel
              client={assistant.assistantChatClient}
              buildSnapshot={assistant.buildAssistantSnapshot}
              onClientOp={assistant.handleAssistantClientOp}
              selection={assistant.chatSelection}
              onClearSelection={() => evidence.setImageSelection(null)}
              lead={lead}
              extra={extra}
            />
          ) : <div className="assistant-chat-scroll"><p className="ws-assistant-status">进入项目后，助手按当前这一步给建议，也可以回答项目里的问题。</p></div>;
        })()}
      </div>
    </aside>
    </>
  );
}
