import { Check } from "lucide-react";

import { STAGE_TONE_LABELS, journeyStages, type PendingItem, type StageId, type StageTone } from "../view-registry";

// 左栏（V3/Left Rail 38:444）：项目上下文、八个阶段、待处理摘要，纵向排布。
// 阶段三态只看该阶段自己有没有数据（界面文档第三节）；每行带读屏文字，不只靠颜色。
export interface StageRailProps {
  projectName: string;
  buildingName: string;
  activeStage: StageId;
  journeyState: (views: readonly string[]) => { tone: StageTone; detail: string };
  pendingItems: readonly PendingItem[];
  onGoTo: (view: StageId) => void;
}

export function StageRail({ projectName, buildingName, activeStage, journeyState, pendingItems, onGoTo }: StageRailProps) {
  const pendingTotal = pendingItems.reduce((sum, item) => sum + item.count, 0);
  return (
    <aside className="ws-rail">
      <div className="ws-rail-context">
        <span className="ws-rail-label">当前任务</span>
        <h2>{projectName}</h2>
        <h3 className="ws-rail-building">{buildingName}</h3>
      </div>
      <span className="ws-rail-heading">任务阶段</span>
      <nav className="ws-stage-nav" aria-label="任务进度">
        {journeyStages.map((stage, index) => {
          const state = journeyState(stage.views);
          // 点阶段进它的第一个视图。已经在这个阶段里的话保持当前视图不动。
          const target = state.tone === "current" ? activeStage : stage.views[0] as StageId;
          return (
            <button
              key={stage.id}
              type="button"
              className={state.tone === "current" ? "ws-stage ws-stage--current" : "ws-stage"}
              aria-current={state.tone === "current" ? "step" : undefined}
              title={state.detail}
              onClick={() => onGoTo(target)}
            >
              <span className="ws-stage-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="ws-stage-title">{stage.label}</span>
              <span className="ws-stage-state" aria-hidden="true">{state.tone === "done" ? <Check size={14} strokeWidth={2.5} /> : null}</span>
              <span className="sr-only">{STAGE_TONE_LABELS[state.tone]}，{state.detail}</span>
            </button>
          );
        })}
      </nav>
      <span className="ws-rail-spacer" />
      {pendingTotal > 0 ? (
        <button type="button" className="ws-rail-summary" title={pendingItems.map((item) => `${item.label} ${item.count}`).join(" · ")} onClick={() => onGoTo(pendingItems[0]!.stage)}>
          <span className="ws-rail-label">待处理</span>
          <strong>{pendingTotal} 项需要人工确认</strong>
          <span className="sr-only">{pendingItems.map((item) => `${item.label} ${item.count}`).join("，")}</span>
        </button>
      ) : (
        <div className="ws-rail-summary">
          <span className="ws-rail-label">待处理</span>
          <strong>没有需要人工确认的事项</strong>
        </div>
      )}
    </aside>
  );
}
