import { useState } from "react";

import { CreateTaskDialog } from "./screens/CreateTaskDialog";
import { ProjectPage, WorkspaceView } from "./screens/Workspace";
import { ServiceRecoveryDialog } from "./screens/Dialogs";
import { ProjectList } from "./screens/ProjectList";
import { AppShell, Banners, CenterFrame, ProjectPageFrame } from "./shell/AppShell";
import { AssistantPanel } from "./shell/AssistantPanel";
import { StageRail } from "./shell/StageRail";
import { Topbar } from "./shell/Topbar";
import { STAGE_DESCRIPTIONS, journeyViewOrder, projectPages, stageLabel, stages, type StageId } from "./view-registry";
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
  const serviceDown = Boolean(error && serverStatus === null && selected);
  const currentTabs = currentJourney
    ? { items: currentJourney.views.map((id) => ({ id, label: stages.find((stage) => stage.id === id)?.label ?? id })), activeId: activeStage, onSelect: (id: string) => goToView(id as StageId) }
    : null;
  const pageTitle = stages.find((stage) => stage.id === activeStage)?.label ?? "";
  const activeViewIndex = journeyViewOrder.indexOf(activeStage);
  const nextView = activeViewIndex >= 0 ? journeyViewOrder[activeViewIndex + 1] ?? null : null;

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
          onProjectList={exitToProjectList}
          onSelectPage={(id) => goToView(id as StageId)}
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
          onGoTo={goToView}
        />
      )}
      center={!selected ? (
        <ProjectList
          cards={session.projectCards}
          onOpen={(id) => void wb.chooseProject(id)}
          onCreate={() => setShowCreate(true)}
          onImport={importProject}
          onClear={() => void clearLibrary()}
          demoUpdates={session.demoUpdates}
          onRetryDemo={() => void session.retryDemoLibrary()}
          onUpdateDemo={() => void session.updateDemoLibrary()}
          loading={session.initializing}
        />
      ) : onProjectPage ? (
        <ProjectPage wb={wb} selected={selected} />
      ) : (
        <CenterFrame
          title={pageTitle}
          description={STAGE_DESCRIPTIONS[activeStage]}
          actions={nextView && activeStage !== "tasks" ? <Button onClick={() => nav.advanceStage()}>下一步：{stageLabel(nextView)}</Button> : undefined}
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
        onSubmit={async (values) => { const created = await wb.createProject(values); if (created) setShowCreate(false); return created; }}
      />
    )}
    </>
  );
}
