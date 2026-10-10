import { componentInputs } from "../component-input";
import type { ComponentCandidateSelection } from "../component-input";
import { currentDimensionCount, pendingDimensionCount } from "../dimension-review";
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
  const [componentCandidateSelection, setComponentCandidateSelection] = useState<ComponentCandidateSelection | null>(null);
  const [dimensionCandidateSelection, setDimensionCandidateSelection] = useState<{ candidateId: string; rowIndex: number } | null>(null);
  const [dimensionReturnView, setDimensionReturnView] = useState<"preview" | "geometry" | null>(null);
  const [issueSelection, setIssueSelection] = useState<string | null>(null);
  // 助手默认收起；进入窄屏时收起，放宽窗口不自动展开。
  const narrowQuery = "(max-width: 1279px)";
  // jsdom 没有 matchMedia，测试环境按宽屏处理
  const matchNarrow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(narrowQuery) : null;
  const [assistantCollapsed, setAssistantCollapsed] = useState(true);
  useEffect(() => {
    const media = matchNarrow();
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => { if (event.matches) setAssistantCollapsed(true); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // 切换视图的唯一入口。左栏、页签、顶栏、待办和助手动作层都走这里。
  // 进项目级页面前先记下当前工作视图，退回时才知道回哪儿。
  const goToView = (viewId: StageId) => {
    if (projectPageIds.has(viewId) && !projectPageIds.has(activeStage)) setReturnView(activeStage);
    setActiveStage(viewId);
  };

  // 推进只在十二个工作视图里走，不会推到项目级页面上去。返回下一视图的名称，没有下一步返回 null。
  const targets = session.confirmedTask?.productionSetup?.targets;
  const hasPreview = session.selected?.snapshot.candidates.some((candidate) => candidate.structured?.kind === "measurementTranscription" || candidate.structured?.kind === "componentRecognition");
  const hasDrawings = session.drawingArtifacts.some((artifact) => artifact.kind === "dxf" || artifact.kind === "pdf");
  const nextView: StageId | null = activeStage === "evidence" ? hasPreview ? "preview" : null
    : activeStage === "preview" ? hasPreview ? "objects" : null
    : activeStage === "objects" ? session.geometryRevision || (session.selected && componentInputs(session.selected.snapshot).length) ? "geometry" : null
    : activeStage === "geometry" ? session.geometryRevision ? targets?.length && targets.every((target) => target === "model") ? "checks" : "sheetStyle" : null
    : activeStage === "sheetStyle" ? hasDrawings ? "drawings" : null
    : activeStage === "drawings" ? hasDrawings ? "checks" : null
    : activeStage === "checks" ? session.latestCheckRun ? "package" : null : null;
  const advanceStage = (): string | null => {
    const next = nextView;
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
    previewCount: session.selected?.snapshot.candidates.reduce((sum, candidate) => sum + (candidate.structured?.kind === "measurementTranscription" ? candidate.structured.dimensions.length : candidate.structured?.kind === "componentRecognition" ? candidate.structured.components.length : 0), 0) ?? 0,
    factCount: session.selected ? currentDimensionCount(session.selected.snapshot) : 0,
    objectCount: session.geometrySpec?.objects.length ?? 0,
    observationCount: session.selected?.snapshot.observations.length ?? 0,
    openIssueCount: session.dashboard?.openIssueCount ?? 0,
    hasGeometryRevision: session.geometryRevision !== null,
    sheetCount: session.confirmedTask?.artifactRequirements ? session.confirmedTask.artifactRequirements.sheets.length : null,
    drawingArtifactCount: session.drawingArtifacts.filter((artifact) => ["drawingIr", "viewGeometry", "dxf", "svg", "pdf", "png", "drawingSourceMap"].includes(artifact.kind)).length,
    hasCheckRun: session.latestCheckRun !== null,
    hasDelivery: session.latestDelivery !== null,
    modelRunCount: session.projectModelRuns.length,
    changeCount: session.changeHistory.length,
    signedOff: session.dashboard?.signoff != null,
  });
  const inputCount = session.selected ? componentInputs(session.selected.snapshot).length : 0;
  if (inputCount && !session.geometryRevision) stageStates.objects = { label: inputCount + " 条制作输入", tone: "active" };
  const pendingDimensions = session.selected ? pendingDimensionCount(session.selected.snapshot) : 0;
  if (session.unitUpdate?.model) stageStates.geometry = { label: "输出单位待更新", tone: "active" };
  if (session.unitUpdate?.drawings) stageStates.drawings = { label: "输出单位待更新", tone: "active" };
  if (pendingDimensions) stageStates.measurements = { label: pendingDimensions + " 条待核对", tone: "active" };
  const journeyState = (views: readonly string[]) => journeyTone(views, activeStage, stageStates);
  const pendingItems = derivePendingItems(session.openIssues);
  if (session.unitUpdate?.model) pendingItems.unshift({ label: "更新模型单位", count: 1, hint: "按当前任务单位重新生成模型文件", stage: "geometry" });
  if (session.unitUpdate?.drawings) pendingItems.unshift({ label: "更新图纸单位", count: 1, hint: "按当前任务单位重新生成并检查图纸", stage: "drawings" });
  if (pendingDimensions) pendingItems.unshift({ label: "核对尺寸", count: pendingDimensions, hint: "逐条核对原资料后采用或驳回", stage: "measurements" });

  return {
    activeStage, setActiveStage, returnView, goToView, advanceStage, nextView,
    selectedGeometryEntityId, setSelectedGeometryEntityId, selectedGeometryEntity, openGeometryObject,
    componentCandidateSelection, setComponentCandidateSelection,
    dimensionCandidateSelection, setDimensionCandidateSelection, dimensionReturnView, setDimensionReturnView,
    issueSelection, setIssueSelection,
    assistantCollapsed, setAssistantCollapsed, toggleAssistant,
    onProjectPage, currentJourney, stageStates, journeyState, pendingItems,
  };
}

export type WorkspaceNav = ReturnType<typeof useWorkspaceNav>;
