import type { ProjectHead } from "@gujian/application";

import { stages, type StageId } from "../view-registry";
import { useDrawingPreviews, useGeometryBlob } from "../workbench/useAssetUrls";
import type { Workbench } from "../workbench/useWorkbench";
import { ChecksAndQualification } from "./ChecksAndQualification";
import { ChangeHistory } from "./ChangeHistory";
import { ComponentList } from "./ComponentList";
import { ConditionRecord } from "./ConditionRecord";
import { DrawingSet } from "./DrawingSet";
import { EvidenceList } from "./EvidenceList";
import { IssueQueue } from "./IssueQueue";
import { MeasurementBaseline } from "./MeasurementBaseline";
import { ModelRuns } from "./ModelRuns";
import { ModelView } from "./ModelView";
import { ProxyDelivery } from "./ProxyDelivery";
import { SheetStyle } from "./SheetStyle";
import { TaskCard } from "./TaskCard";

// 十一个工作区视图与两个项目级页面的接线：把 useWorkbench 的切片与回调交给各屏。
// 屏幕组件只接 props，不 import 组合根。
export function WorkspaceView({ wb, selected }: { wb: Workbench; selected: ProjectHead }) {
  const { session, nav, evidence, jobs, writes } = wb;
  const {
    projectArchetypes, changeHistory, serverStatus,
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

  return (
    <>
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
    </>
  );
}

export function ProjectPage({ wb, selected }: { wb: Workbench; selected: ProjectHead }) {
  const { session, nav, jobs, writes } = wb;
  const {
    projectArchetypes, changeHistory, serverStatus,
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

  return (
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
  );
}
