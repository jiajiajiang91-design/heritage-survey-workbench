import { useState } from "react";

import { ChecksAndQualification } from "./screens/ChecksAndQualification";
import { ChangeHistory } from "./screens/ChangeHistory";
import { ComponentList } from "./screens/ComponentList";
import { ConditionRecord } from "./screens/ConditionRecord";
import { CreateTaskDialog } from "./screens/CreateTaskDialog";
import { ServiceRecoveryDialog } from "./screens/Dialogs";
import { DrawingSet } from "./screens/DrawingSet";
import { EvidenceList } from "./screens/EvidenceList";
import { IssueQueue } from "./screens/IssueQueue";
import { MeasurementBaseline } from "./screens/MeasurementBaseline";
import { ModelRuns } from "./screens/ModelRuns";
import { ModelView } from "./screens/ModelView";
import { ProjectList } from "./screens/ProjectList";
import { ProxyDelivery } from "./screens/ProxyDelivery";
import { SheetStyle } from "./screens/SheetStyle";
import { TaskCard } from "./screens/TaskCard";
import { AppShell, Banners, CenterFrame, ProjectPageFrame } from "./shell/AppShell";
import { AssistantPanel } from "./shell/AssistantPanel";
import { StageRail } from "./shell/StageRail";
import { Topbar } from "./shell/Topbar";
import { projectPages, stages, type StageId } from "./view-registry";
import { useDrawingPreviews, useGeometryBlob } from "./workbench/useAssetUrls";
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
  const { notices, session, nav, evidence, jobs, writes, assistant } = wb;
  const { error, notice, setError, setNotice } = notices;
  const {
    selected, query, setQuery, projectArchetypes, changeHistory, serverStatus, exitToProjectList, clearLibrary,
    parsedEvidenceCount, readableDrawingEvidenceIds, confirmedTask, openIssues, geometryRevision, geometrySpec,
    latestCheckRun, drawingArtifacts, latestDelivery, latestBlockedDelivery, geometryGate, dashboard, artifactSetView,
    modelCostView, humanInterventions, deliveryBlockers, archetypeDifferences, typeLabel, evidenceTitle, factFieldLabel,
    measuredRecordCount, blockerReasons,
  } = session;
  const {
    activeStage, returnView, goToView, setSelectedGeometryEntityId, selectedGeometryEntity, assistantCollapsed,
    setAssistantCollapsed, onProjectPage, currentJourney, journeyState, pendingItems,
  } = nav;
  const {
    modelRunning, drawingRunning, showDrawingTask, drawingProgress, drawingCancelling, exportProgress, showExportTask,
    generateDrawings, cancelDrawings, downloadProject, cancelExport, runModel, transcribeDrawings,
  } = jobs;
  const {
    roundTripReceipt, confirmGeometryFacts, createProxyDelivery, recordBlockedDelivery, downloadArtifact,
    registerArchetype, uploadEvidenceFiles, confirmTranscribedDimensions, confirmRecognizedComponents,
    submitTaskSetup, decideCandidate, decideIssueOption, recordObservation, confirmDocumentedDimensionChain,
    verifyEmptyLibraryRoundTrip,
  } = writes;
  const geometryBlob = useGeometryBlob(geometryRevision);
  const drawingPreviewUrls = useDrawingPreviews(drawingArtifacts);
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
        activeStage === "history" ? (
          <ChangeHistory
            entries={changeHistory}
            responsibilities={confirmedTask?.responsibilities ?? []}
            back={{ label: stages.find((stage) => stage.id === returnView)?.label ?? "", onBack: () => goToView(returnView) }}
          />
        ) : (
          <ModelRuns
            runs={session.projectModelRuns}
            costView={modelCostView}
            candidates={selected.snapshot.candidates}
            exclusionCount={selected.snapshot.exclusionRecords.length}
            serverModel={serverStatus?.model ?? null}
            modelConfigured={serverStatus?.modelConfigured ?? false}
            canRun={Boolean(parsedEvidenceCount || readableDrawingEvidenceIds.length) && !modelRunning && Boolean(serverStatus?.modelConfigured)}
            running={modelRunning}
            hasReadableDrawings={readableDrawingEvidenceIds.length > 0}
            evidenceTitle={evidenceTitle}
            onRun={() => void runModel()}
            onRefreshStatus={() => void session.refreshServerStatus()}
            onConfirmComponents={(candidate) => void confirmRecognizedComponents(candidate)}
            onConfirmDimensions={(candidate) => void confirmTranscribedDimensions(candidate)}
            back={{ label: stages.find((stage) => stage.id === returnView)?.label ?? "", onBack: () => goToView(returnView) }}
          />
        )
      ) : (
        <CenterFrame title={pageTitle} tabs={currentTabs} fill>
            {activeStage === "tasks" && (
              <TaskCard
                snapshot={selected.snapshot}
                confirmedTask={confirmedTask}
                objectCount={geometrySpec?.objects.length ?? 0}
                objectProducerCounts={(geometrySpec?.objects ?? []).reduce<Record<string, number>>((acc, object) => { acc[object.producer.producerType] = (acc[object.producer.producerType] ?? 0) + 1; return acc; }, {})}
                measuredRecordCount={measuredRecordCount}
                qualificationLabel={dashboard?.qualificationLabel ?? null}
                onSubmitTask={submitTaskSetup}
                onEnterEvidence={() => goToView("evidence")}
              />
            )}

            {activeStage === "evidence" && (
              <EvidenceList
                snapshot={selected.snapshot}
                pane={evidence}
                readableDrawingCount={readableDrawingEvidenceIds.length}
                modelRunning={modelRunning}
                onUpload={uploadEvidenceFiles}
                onTranscribe={() => void transcribeDrawings()}
                onGoToIssues={() => goToView("issues")}
              />
            )}

            {activeStage === "measurements" && (
              <MeasurementBaseline
                snapshot={selected.snapshot}
                pane={evidence}
                archetypes={projectArchetypes}
                evidenceTitle={evidenceTitle}
                factFieldLabel={factFieldLabel}
                onRegisterArchetype={registerArchetype}
                onConfirmDimensionChain={confirmDocumentedDimensionChain}
              />
            )}

            {activeStage === "objects" && (
              <ComponentList
                snapshot={selected.snapshot}
                objects={geometrySpec?.objects ?? []}
                unknowns={geometrySpec?.unknowns ?? []}
                pane={evidence}
                typeLabel={typeLabel}
                selectedObjectId={nav.selectedGeometryEntityId}
                onSelectObject={setSelectedGeometryEntityId}
                onOpenInModel={nav.openGeometryObject}
                modelConfigured={serverStatus?.modelConfigured ?? false}
              />
            )}

            {activeStage === "conditions" && (
              <ConditionRecord
                snapshot={selected.snapshot}
                pane={evidence}
                archetypeDifferences={archetypeDifferences}
                evidenceTitle={evidenceTitle}
                onRecord={recordObservation}
                onEnterIssues={() => goToView("issues")}
              />
            )}

            {activeStage === "issues" && (
              <IssueQueue
                snapshot={selected.snapshot}
                openIssues={openIssues}
                taskConfirmed={confirmedTask !== null}
                evidenceTitle={evidenceTitle}
                humanInterventions={humanInterventions}
                onDecideCandidate={decideCandidate}
                onDecideOption={decideIssueOption}
                onGoToTask={() => goToView("tasks")}
                onGoToEvidence={() => goToView("evidence")}
              />
            )}

            {activeStage === "geometry" && (
              <ModelView
                snapshot={selected.snapshot}
                geometryRevision={geometryRevision}
                geometrySpec={geometrySpec}
                geometryBlob={geometryBlob}
                geometryGate={geometryGate}
                jobs={jobs}
                typeLabel={typeLabel}
                selectedObjectId={nav.selectedGeometryEntityId}
                onSelectObject={setSelectedGeometryEntityId}
                onConfirmGeometryFacts={confirmGeometryFacts}
              />
            )}

            {activeStage === "sheetStyle" && (
              <SheetStyle
                task={confirmedTask}
                previews={drawingPreviewUrls}
                canGenerate={Boolean(geometryRevision && confirmedTask) && !drawingRunning}
                generating={drawingRunning}
                onGenerate={() => void generateDrawings()}
                onEditTask={() => goToView("tasks")}
              />
            )}

            {activeStage === "drawings" && (
              <DrawingSet
                artifacts={drawingArtifacts}
                previews={drawingPreviewUrls}
                latestCheckRun={latestCheckRun}
                hasGeometry={geometryRevision !== null}
                hasTask={confirmedTask !== null}
                generating={drawingRunning}
                showTask={showDrawingTask}
                progressPhase={drawingProgress}
                cancelling={drawingCancelling}
                onGenerate={() => void generateDrawings()}
                onCancel={() => void cancelDrawings()}
                onDownload={(artifact) => void downloadArtifact(artifact)}
              />
            )}

            {activeStage === "checks" && (
              <ChecksAndQualification
                previews={drawingPreviewUrls}
                drawingArtifacts={drawingArtifacts}
                latestCheckRun={latestCheckRun}
                unknownCount={geometrySpec?.unknowns.length ?? 0}
                currentArtifactCount={artifactSetView?.currentArtifacts.length ?? 0}
                crossRevisionArtifactCount={artifactSetView?.crossRevisionArtifactCount ?? 0}
                qualificationLabel={dashboard?.qualificationLabel ?? null}
                blockerReasons={blockerReasons}
                blockerCodes={dashboard?.blockerCodes ?? []}
                generating={drawingRunning}
                canRegenerate={Boolean(geometryRevision && confirmedTask) && !drawingRunning}
                onRegenerate={() => void generateDrawings()}
                onDownload={(artifact) => void downloadArtifact(artifact)}
                sheetCaption={confirmedTask?.artifactRequirements ? `${confirmedTask.artifactRequirements.views.map((view) => `${view.displayLabelZh} 1:${view.scaleDenominator}`).join("，")} · 图幅 ${confirmedTask.artifactRequirements.sheets.map((sheet) => `${sheet.drawingNumber} ${sheet.pageMm[0]}×${sheet.pageMm[1]}`).join("，")} · 版本 ${confirmedTask.artifactRequirements.revisionLabel}` : null}
              />
            )}

            {activeStage === "package" && (
              <ProxyDelivery
                projectName={selected.snapshot.project.name}
                buildingName={selected.snapshot.buildings[0]?.name ?? ""}
                responsibilityRoles={confirmedTask?.responsibilities.map((item) => item.role) ?? []}
                artifacts={drawingArtifacts}
                checkRuns={session.projectCheckRuns}
                latestCheckRun={latestCheckRun}
                latestDelivery={latestDelivery}
                latestBlockedDelivery={latestBlockedDelivery}
                deliveryBlockers={deliveryBlockers}
                blockerCodes={dashboard?.blockerCodes ?? []}
                canCreate={Boolean(geometryRevision && latestCheckRun && drawingArtifacts.length && !latestDelivery)}
                exporting={Boolean(exportProgress)}
                showExportTask={showExportTask}
                exportPhase={exportProgress?.phase ?? null}
                exportCancelling={exportProgress?.cancelling ?? false}
                roundTripReceipt={roundTripReceipt}
                onCreate={() => void createProxyDelivery()}
                onRecordBlocked={() => void recordBlockedDelivery()}
                onExport={(type) => void downloadProject(type)}
                onCancelExport={cancelExport}
                onVerifyRoundTrip={() => void verifyEmptyLibraryRoundTrip()}
                onDownload={(artifact) => void downloadArtifact(artifact)}
              />
            )}
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
