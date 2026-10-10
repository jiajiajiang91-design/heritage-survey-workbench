import { useState } from "react";
import { isModelOnlyTask } from "./delivery-readiness";

import { CreateTaskDialog } from "./screens/CreateTaskDialog";
import { portfolioReturnHref } from "./portfolio-return";
import { ProjectPage, WorkspaceView } from "./screens/Workspace";
import { ServiceRecoveryDialog } from "./screens/Dialogs";
import { ProjectList } from "./screens/ProjectList";
import { AppShell, Banners, CenterFrame, ProjectPageFrame } from "./shell/AppShell";
import { AssistantPanel } from "./shell/AssistantPanel";
import { StageRail } from "./shell/StageRail";
import { Topbar } from "./shell/Topbar";
import { STAGE_DESCRIPTIONS, projectPages, stageLabel, stages, type StageId } from "./view-registry";
import { Button } from "./ui";
import { useWorkbench, type WorkbenchOptions } from "./workbench/useWorkbench";

// 组合根：状态与命令处理在 workbench/ 的 hook 里，页面在 screens/ 里，这里只按当前视图选屏。
// 注册表与标签表已搬到 view-registry.ts 与 labels.ts，这里再导出给既有引用。
export { journeyStages, projectPages, stages } from "./view-registry";
export {
  DATA_STATUS_LABELS, ENTITY_ORIGIN_LABELS, EVIDENCE_TYPE_LABELS, PARSE_STATUS_LABELS, PRODUCER_LABELS, REVIEW_LABELS,
} from "./labels";
export { STAGE_TONE_LABELS } from "./view-registry";
export const LENGTH_INPUT_STEP = "any";

export type AppProps = WorkbenchOptions;

export function App({ bootstrapDemo }: AppProps = {}) {
  const wb = useWorkbench(bootstrapDemo ? { bootstrapDemo } : {});
  const returnHref = portfolioReturnHref(window.location.search, window.location.hostname);
  const { notices, session, nav, evidence, jobs, assistant } = wb;
  const { error, notice, setError, setNotice } = notices;
  const { selected, serverStatus, exitToProjectList, clearLibrary, confirmedTask, drawingArtifacts, latestCheckRun } = session;
  const { activeStage, returnView, goToView, selectedGeometryEntity, assistantCollapsed, setAssistantCollapsed, onProjectPage, currentJourney, journeyState, pendingItems } = nav;
  const [showCreate, setShowCreate] = useState(false);
  const importProject = (file: File) => wb.importProject(file).then(() => undefined);

  const pages = projectPages.map((id) => ({ id, label: stages.find((stage) => stage.id === id)?.label ?? id, active: activeStage === id }));
  // 面包屑按 v4：列表页写项目列表，项目级页面写页面名，工作区写项目名 / 建筑名 比例
  const breadcrumb = !selected
    ? "项目列表"
    : onProjectPage
      ? stageLabel(activeStage)
      : [selected.snapshot.project.name, [selected.snapshot.buildings[0]?.name, confirmedTask?.artifactRequirements?.views[0] ? `1:${confirmedTask.artifactRequirements.views[0].scaleDenominator}` : null].filter(Boolean).join(" ")].join(" / ");
  const single = !selected || onProjectPage;
  // 服务中断时只出 B04 对话框，不再同时压一条错误横幅（v4 66:4120 只有对话框）
  const serviceDown = Boolean(error?.kind === "serviceUnavailable" && serverStatus === null && selected);
  const currentTabs = currentJourney
    ? { items: currentJourney.views.filter((id) => id !== "measurements").map((id) => ({ id, label: stages.find((stage) => stage.id === id)?.label ?? id })), activeId: activeStage === "measurements" ? "preview" : activeStage, onSelect: (id: string) => goToView(id as StageId) }
    : null;
  const pageTitle = stages.find((stage) => stage.id === activeStage)?.label ?? "";
  const demoLimitationZh = selected ? session.projectCards.find((card) => card.projectId === selected.projectId)?.demoLimitationZh ?? null : null;
  const pageDescription = demoLimitationZh && activeStage === "checks"
    ? "核对自动检查与流程演示签发记录；该记录不构成真实工程签发。"
    : demoLimitationZh && activeStage === "package"
      ? "查看图纸、模型、检查结果与来源说明；当前展示归档不构成真实工程交付。"
      : STAGE_DESCRIPTIONS[activeStage];
  const nextView = nav.nextView;

  return (
    <>
    <AppShell
      single={single}
      assistantCollapsed={assistantCollapsed}
      topbar={(
        <Topbar
          breadcrumb={breadcrumb}
          pages={pages}
          pagesEnabled={Boolean(selected)}
          projectListActive={!selected}
          onProjectList={() => { setError(null); setNotice(null); exitToProjectList(); }}
          onSelectPage={(id) => goToView(id as StageId)}
          portfolioReturnHref={returnHref}
          assistantToggle={selected && !onProjectPage && assistantCollapsed ? { collapsed: true, onToggle: () => setAssistantCollapsed(false) } : null}
        />
      )}
      rail={selected && (
        <StageRail
          projectName={selected.snapshot.project.name}
          buildingName={selected.snapshot.buildings[0]?.name ?? ""}
          activeStage={activeStage}
          journeyState={journeyState}
          pendingItems={pendingItems}
          modelOnly={isModelOnlyTask(confirmedTask)}
          onGoTo={goToView}
        />
      )}
      center={!selected ? (
        <ProjectList
          cards={session.projectCards}
          onOpen={(id, showExample) => void wb.chooseProject(id, showExample)}
          onCreate={() => setShowCreate(true)}
          onImport={importProject}
          onClear={() => void clearLibrary()}
          demoUpdates={session.demoUpdates}
          onRetryDemo={() => void session.retryDemoLibrary()}
          onUpdateDemo={() => void session.updateDemoLibrary()}
          loading={session.initializing}
          demoManifestEntries={session.demoManifestEntries}
        />
      ) : onProjectPage ? (
        <ProjectPage wb={wb} selected={selected} />
      ) : (
        <CenterFrame
          title={pageTitle}
          description={pageDescription}
          actions={<div className="gj-actions">{activeStage === "preview" && <Button variant="text" onClick={() => { nav.setDimensionCandidateSelection(null); nav.setDimensionReturnView("preview"); goToView("measurements"); }}>批量核对尺寸</Button>}{nextView && <Button onClick={() => nav.advanceStage()}>前往{stageLabel(nextView)}</Button>}</div>}
          tabs={currentTabs}
          fill
        >
          <WorkspaceView wb={wb} selected={selected} />
        </CenterFrame>
      )}
      assistant={(
        <AssistantPanel
          hasProject={selected !== null}
          activeStage={activeStage}
          assistant={assistant}
          jobs={jobs}
          evidence={evidence}
          collapsed={assistantCollapsed}
          onExpand={() => setAssistantCollapsed(false)}
          onCollapse={() => setAssistantCollapsed(true)}
          modelConfigured={serverStatus?.modelConfigured ?? false}
          modelName={serverStatus?.model}
        />
      )}
      banners={<Banners error={serviceDown ? null : error} notice={notice} onDismissError={() => setError(null)} onDismissNotice={() => setNotice(null)} />}
    />
    {serviceDown && (
      <ServiceRecoveryDialog
        hasDrawings={drawingArtifacts.length > 0}
        hasCheck={latestCheckRun !== null}
        onViewLast={() => setError(null)}
        onRetry={() => { setError(null); void session.refreshServerStatus(); }}
      />
    )}
    {showCreate && (
      <CreateTaskDialog
        onClose={() => setShowCreate(false)}
        onSubmit={async (values, files, destination) => { const created = await wb.createProject(values, files, destination); if (created) setShowCreate(false); return created; }}
      />
    )}
    </>
  );
}
