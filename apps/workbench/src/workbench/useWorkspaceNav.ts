import { useEffect, useState } from "react";

import {
  derivePendingItems, deriveStageStates, journeyStages, journeyTone, journeyViewOrder, projectPageIds, stageLabel,
  type StageId,
} from "../view-registry";
import type { ProjectSession } from "./useProjectSession";

// 工作区导航：当前视图、项目级页面的返回点、选中的几何对象、助手栏开合。
export function useWorkspaceNav(session: ProjectSession) {
  const [activeStage, setActiveStage] = useState<StageId>("evidence");
  // 从项目级页面退回时回到进去之前那个视图，不要一律弹回默认视图。
  const [returnView, setReturnView] = useState<StageId>("evidence");
  const [selectedGeometryEntityId, setSelectedGeometryEntityId] = useState<string | null>(null);
  // 窄于 1280 时助手栏默认收起，改为顶栏图标唤起（裁决记录第一节第 5 条）；用户展开后浮在中栏上
  const narrowQuery = "(max-width: 1279px)";
  // jsdom 没有 matchMedia，测试环境按宽屏处理
  const matchNarrow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(narrowQuery) : null;
  const [assistantCollapsed, setAssistantCollapsed] = useState(() => matchNarrow()?.matches ?? false);
  useEffect(() => {
    const media = matchNarrow();
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setAssistantCollapsed(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // 切换视图的唯一入口。左栏、页签、顶栏、待办和助手动作层都走这里。
  // 进项目级页面前先记下当前工作视图，退回时才知道回哪儿。
  const goToView = (viewId: StageId) => {
    if (projectPageIds.has(viewId) && !projectPageIds.has(activeStage)) setReturnView(activeStage);
    setActiveStage(viewId);
  };

  // 推进只在十一个工作视图里走，不会推到项目级页面上去。返回下一视图的名称，没有下一步返回 null。
  const advanceStage = (): string | null => {
    const index = journeyViewOrder.indexOf(activeStage);
    const next = index < 0 ? undefined : journeyViewOrder[index + 1];
    if (!next) return null;
    setActiveStage(next);
    return stageLabel(next);
  };

  const openGeometryObject = (objectId: string) => {
    setSelectedGeometryEntityId(objectId);
    setActiveStage("geometry");
  };

  const toggleAssistant = () => setAssistantCollapsed((value) => !value);

  // 项目级页面只占一栏，左栏与助手栏都不出现。
  const onProjectPage = projectPageIds.has(activeStage);
  const currentJourney = journeyStages.find((stage) => (stage.views as readonly string[]).includes(activeStage));

  const selectedGeometryEntity = session.geometrySpec?.objects.find((item) => item.id === selectedGeometryEntityId) ?? null;

  const stageStates = deriveStageStates({
    taskConfirmed: session.confirmedTask !== null,
    evidenceCount: session.selected?.snapshot.evidences.length ?? 0,
    factCount: session.selected?.snapshot.facts.length ?? 0,
    objectCount: session.geometrySpec?.objects.length ?? 0,
    observationCount: session.selected?.snapshot.observations.length ?? 0,
    openIssueCount: session.dashboard?.openIssueCount ?? 0,
    hasGeometryRevision: session.geometryRevision !== null,
    sheetCount: session.confirmedTask?.artifactRequirements ? session.confirmedTask.artifactRequirements.sheets.length : null,
    drawingArtifactCount: session.drawingArtifacts.length,
    hasCheckRun: session.latestCheckRun !== null,
    hasDelivery: session.latestDelivery !== null,
    modelRunCount: session.projectModelRuns.length,
    changeCount: session.changeHistory.length,
  });
  const journeyState = (views: readonly string[]) => journeyTone(views, activeStage, stageStates);
  const pendingItems = derivePendingItems(session.openIssues);

  return {
    activeStage, setActiveStage, returnView, goToView, advanceStage,
    selectedGeometryEntityId, setSelectedGeometryEntityId, selectedGeometryEntity, openGeometryObject,
    assistantCollapsed, setAssistantCollapsed, toggleAssistant,
    onProjectPage, currentJourney, stageStates, journeyState, pendingItems,
  };
}

export type WorkspaceNav = ReturnType<typeof useWorkspaceNav>;
