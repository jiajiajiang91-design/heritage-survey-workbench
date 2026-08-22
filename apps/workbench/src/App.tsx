import { useState } from "react";

import { CreateTaskDialog } from "./screens/CreateTaskDialog";
import { ProjectPage, WorkspaceView } from "./screens/Workspace";
import { ServiceRecoveryDialog } from "./screens/Dialogs";
import { ProjectList } from "./screens/ProjectList";
import { AppShell, Banners, CenterFrame, ProjectPageFrame } from "./shell/AppShell";
import { AssistantPanel } from "./shell/AssistantPanel";
import { StageRail } from "./shell/StageRail";
import { Topbar } from "./shell/Topbar";
import { STAGE_DESCRIPTIONS, projectPages, stages, type StageId } from "./view-registry";
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
  const { selected, query, setQuery, serverStatus, exitToProjectList, clearLibrary, confirmedTask, drawingArtifacts, latestCheckRun, dashboard } = session;
  const { activeStage, returnView, goToView, selectedGeometryEntity, assistantCollapsed, setAssistantCollapsed, onProjectPage, currentJourney, journeyState, pendingItems } = nav;
  const [showCreate, setShowCreate] = useState(false);
  const importProject = (file: File) => wb.importProject(file).then(() => undefined);

  const pages = projectPages.map((id) => ({ id, label: stages.find((stage) => stage.id === id)?.label ?? id, active: activeStage === id }));
  const breadcrumb = selected
    ? [selected.snapshot.project.name, [selected.snapshot.buildings[0]?.name, confirmedTask?.artifactRequirements?.views[0] ? `1:${confirmedTask.artifactRequirements.views[0].scaleDenominator}` : null].filter(Boolean).join(" ")].join(" / ")
    : null;
  const single = !selected || onProjectPage;
  const currentTabs = currentJourney
    ? { items: currentJourney.views.map((id) => ({ id, label: stages.find((stage) => stage.id === id)?.label ?? id })), activeId: activeStage, onSelect: (id: string) => goToView(id as StageId) }
    : null;
  const pageTitle = stages.find((stage) => stage.id === activeStage)?.label ?? "";

  return (
    <>
    <AppShell
      single={single}
      assistantCollapsed={assistantCollapsed}
      topbar={(
        <Topbar
          breadcrumb={breadcrumb}
          pages={selected ? pages : []}
          projectListActive={!selected}
          onProjectList={exitToProjectList}
          onSelectPage={(id) => goToView(id as StageId)}
          assistantToggle={selected && !onProjectPage ? { collapsed: assistantCollapsed, onToggle: () => setAssistantCollapsed((value) => !value) } : null}
        />
      )}
      rail={selected && (
        <StageRail
          projectName={selected.snapshot.project.name}
          buildingName={selected.snapshot.buildings[0]?.name ?? ""}
          activeStage={activeStage}
          journeyState={journeyState}
          pendingItems={pendingItems}
          qualificationLabel={dashboard?.qualificationLabel ?? null}
          onGoTo={goToView}
        />
      )}
      center={!selected ? (
        <ProjectList
          cards={session.projectCards}
          query={query}
          onQuery={setQuery}
          onOpen={(id) => void wb.chooseProject(id)}
          onCreate={() => setShowCreate(true)}
          onImport={importProject}
          onClear={() => void clearLibrary()}
        />
      ) : onProjectPage ? (
        <ProjectPage wb={wb} selected={selected} />
      ) : (
        <CenterFrame title={pageTitle} description={STAGE_DESCRIPTIONS[activeStage]} tabs={currentTabs} fill>
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
          selectedEntityName={selectedGeometryEntity?.displayNameZh ?? null}
          modelConfigured={serverStatus?.modelConfigured ?? false}
        />
      )}
      banners={<Banners error={error} notice={notice} onDismissError={() => setError(null)} onDismissNotice={() => setNotice(null)} />}
    />
    {error && serverStatus === null && selected && (
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
