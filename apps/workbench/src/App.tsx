import { FileCheck2, FileJson, Images, PackageOpen, Play, Ruler, ShieldCheck, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { compareWithMeasuredFacts, deriveArchetypeExpectations } from "@gujian/infrastructure";

import { EvidenceMarquee } from "./EvidenceMarquee";
import { GlbViewer } from "./GlbViewer";
import {
  DATA_STATUS_LABELS, DRAWING_KIND_LABELS, ENTITY_ORIGIN_LABELS, EVIDENCE_TYPE_LABELS, ISSUE_TYPE_LABELS,
  LIFT_RATIO_SET_LABELS, OBSERVATION_LABELS, PARSE_STATUS_LABELS, PRODUCER_LABELS, REVIEW_LABELS, cadPhaseLabel,
} from "./labels";
import { LongTask } from "./LongTask";
import { formatCost } from "./model-pricing";
import { DrawingLimitationNote, QualificationChip } from "./QualificationNotice";
import { describeBlocker } from "./qualification";
import { ChecksAndQualification } from "./screens/ChecksAndQualification";
import { ComponentList } from "./screens/ComponentList";
import { ConditionRecord } from "./screens/ConditionRecord";
import { EvidenceList } from "./screens/EvidenceList";
import { IssueQueue } from "./screens/IssueQueue";
import { MeasurementBaseline } from "./screens/MeasurementBaseline";
import { ModelView } from "./screens/ModelView";
import { DrawingSet } from "./screens/DrawingSet";
import { ProjectList } from "./screens/ProjectList";
import { ProxyDelivery } from "./screens/ProxyDelivery";
import { SheetStyle } from "./screens/SheetStyle";
import { TaskCard } from "./screens/TaskCard";
import { AppShell, Banners, CenterFrame, ProjectPageFrame } from "./shell/AppShell";
import { AssistantPanel } from "./shell/AssistantPanel";
import { StageRail } from "./shell/StageRail";
import { Topbar } from "./shell/Topbar";
import { Button, Dialog, Field } from "./ui";
import { projectPages, stages, type StageId } from "./view-registry";
import { useDrawingPreviews, useGeometryBlob } from "./workbench/useAssetUrls";
import { readTaskSetupForm } from "./workbench/useRecordWrites";
import { useWorkbench, type WorkbenchOptions } from "./workbench/useWorkbench";

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
    selected, filtered, query, setQuery, projectRuleRuns, projectDecisions, projectArchetypes,
    changeHistory, serverStatus, exitToProjectList, clearLibrary,
    parsedEvidenceCount, readableDrawingEvidenceIds, confirmedTask, openIssues, geometryRevision, geometrySpec,
    latestCheckRun, drawingArtifacts, latestDelivery, latestBlockedDelivery, geometryGate, dashboard, artifactSetView,
    modelCostView, humanInterventions, deliveryBlockers, archetypeDifferences, typeLabel, evidenceTitle, factFieldLabel,
    basisCounts, measuredRecordCount, blockerReasons,
  } = session;
  const {
    activeStage, setActiveStage, returnView, goToView, setSelectedGeometryEntityId,
    selectedGeometryEntity, assistantCollapsed, setAssistantCollapsed, onProjectPage, currentJourney, journeyState,
    pendingItems,
  } = nav;
  const { activeEvidenceId, setActiveEvidenceId, evidencePreview, imageSelection, setImageSelection, downloadEvidence } = evidence;
  const {
    modelProgress, cadProgress, drawingProgress, exportProgress, cadCancelling, drawingCancelling,
    modelRunning, geometryRunning, drawingRunning, showGeometryTask, showDrawingTask, showExportTask,
    generateDemoGeometry, cancelGeometry, generateDrawings, cancelDrawings, downloadProject, cancelExport,
    runModel, transcribeDrawings, cancelModel,
  } = jobs;
  const {
    roundTripReceipt, confirmGeometryFacts, createProxyDelivery, recordBlockedDelivery, downloadArtifact,
    registerArchetype, uploadEvidenceFiles, confirmTranscribedDimensions, confirmRecognizedComponents,
    submitTaskSetup, decideCandidate, decideIssueOption, recordObservation, confirmDocumentedDimensionChain,
    verifyEmptyLibraryRoundTrip,
  } = writes;
  const {
    assistantChatClient, pendingProposal, buildAssistantSnapshot, handleAssistantClientOp, adoptProposal,
    rejectProposal, currentStatusText, provenance, chatSelection,
  } = assistant;
  const geometryBlob = useGeometryBlob(geometryRevision);
  const drawingPreviewUrls = useDrawingPreviews(drawingArtifacts);

  // 以下是页面自己的状态：对话框开合、表单草稿、文件输入与分隔条。
  const [showCreate, setShowCreate] = useState(false);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  // 数据与证据双半区默认各占一半，分隔条可拖动，比例限制在 30% 至 70%（07 第 6 节）
  const [dataPaneRatio, setDataPaneRatio] = useState(50);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const created = await wb.createProject({
      name: String(data.get("name") ?? "").trim(),
      buildingName: String(data.get("buildingName") ?? "").trim(),
      locationText: String(data.get("locationText") ?? "").trim(),
    });
    if (created) setShowCreate(false);
  };
  const importProject = async (file: File) => {
    await wb.importProject(file);
    if (importInput.current) importInput.current.value = "";
  };
  const uploadFromInput = async (files: readonly File[]) => {
    await uploadEvidenceFiles(files);
    if (evidenceInput.current) evidenceInput.current.value = "";
  };
  const submitTaskForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitTaskSetup(readTaskSetupForm(new FormData(event.currentTarget)));
  };
  const submitObservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await recordObservation({
      observationType: String(data.get("observationType") ?? "visibleCondition"),
      subjectRef: String(data.get("subjectRef") ?? ""),
      evidenceRef: String(data.get("evidenceRef") ?? ""),
      text: String(data.get("text") ?? ""),
    });
    if (ok) form.reset();
  };
  const clearReason = (issueId: string) => setDecisionReasons((current) => ({ ...current, [issueId]: "" }));
  const decideCandidateFromForm = async (issueId: string, candidateId: string, outcome: "accepted" | "rejected") => {
    if (await decideCandidate(issueId, candidateId, outcome, decisionReasons[issueId] ?? "")) clearReason(issueId);
  };
  const decideIssueOptionFromForm = async (issueId: string, outcome: "accepted" | "rejected") => {
    if (await decideIssueOption(issueId, outcome, selectedOptions[issueId] ?? null, decisionReasons[issueId] ?? "")) clearReason(issueId);
  };

  // 分隔条拖动：按中栏宽度换算比例，限制在 30% 至 70%
  const startSplitDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const move = (pointer: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const ratio = ((pointer.clientX - bounds.left) / bounds.width) * 100;
      setDataPaneRatio(Math.min(70, Math.max(30, ratio)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  // 键盘可达：方向键以 5% 步进调整（07 第 7 节）
  const nudgeSplit = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setDataPaneRatio((current) => Math.min(70, Math.max(30, current + (event.key === "ArrowRight" ? 5 : -5))));
  };

  // 数据与证据双半区（05 表 2、07 第 6 节）：左数据、右证据，中间分隔条
  const renderSplit = (data: ReactNode, emptyHint: string) => (
    <div className="stage-split" ref={splitRef} style={{ gridTemplateColumns: `${dataPaneRatio}% 8px minmax(0, 1fr)` }}>
      <div className="pane-data">{data}</div>
      <div
        className="pane-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整数据区与证据区的宽度"
        aria-valuenow={Math.round(dataPaneRatio)}
        aria-valuemin={30}
        aria-valuemax={70}
        tabIndex={0}
        onPointerDown={startSplitDrag}
        onKeyDown={nudgeSplit}
      />
      <aside className="pane-evidence" aria-label="证据区">
        <header>
          <strong>资料原件</strong>
          {evidencePreview && <small>{evidencePreview.fileName}</small>}
        </header>
        <div className="pane-evidence-body">
          {selected && selected.snapshot.evidences.length > 1 && (
            <div className="evidence-switch">
              {selected.snapshot.evidences.map((evidence) => (
                <button key={evidence.id} type="button" className={activeEvidenceId === evidence.id ? "active" : ""}
                  onClick={() => setActiveEvidenceId(evidence.id)}>{evidence.title}</button>
              ))}
            </div>
          )}
          {evidencePreview ? (
            evidencePreview.mimeType.startsWith("image/")
              ? (
                <EvidenceMarquee
                  src={evidencePreview.url}
                  alt={`${evidencePreview.fileName} 原件`}
                  selection={imageSelection?.evidenceId === evidencePreview.evidenceId ? imageSelection.rectNormalized : null}
                  onSelect={(rect) => setImageSelection(
                    rect ? { evidenceId: evidencePreview.evidenceId, rectNormalized: rect } : null,
                  )}
                />
              )
              : evidencePreview.mimeType === "application/pdf"
                ? <object data={evidencePreview.url} type="application/pdf" aria-label={`${evidencePreview.fileName} 原件`} />
                : <div className="gj-empty"><p>该类型的文件无法在页内显示。</p><button className="gj-btn gj-btn--text" type="button" onClick={() => { const evidence = selected?.snapshot.evidences.find((item) => item.id === activeEvidenceId); if (evidence) void downloadEvidence(evidence.assetId); }}>下载原文件核对</button></div>
          ) : <div className="gj-empty"><p>{selected?.snapshot.evidences.length ? emptyHint : "还没有资料。上传后可在此对照原件核对数据。"}</p></div>}
        </div>
      </aside>
    </div>
  );

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
        <ProjectPageFrame title={pageTitle} back={{ label: stages.find((stage) => stage.id === returnView)?.label ?? "", onBack: () => goToView(returnView) }}>
            {activeStage === "history" && (
              <section className="evidence-board">
                <header className="board-heading">
                  <div><h3>修改历史</h3></div>
                  <span className="board-count">{changeHistory.length} 次写入</span>
                </header>
                {renderSplit(<>
                <div className="history-list">
                  {changeHistory.map((entry) => (
                    <article className="history-row" key={entry.id}>
                      <div className="history-when">
                        <strong>{entry.actionZh}</strong>
                        <small>{entry.occurredAt.replace("T", " ").slice(0, 19)}</small>
                      </div>
                      <div className="history-what">
                        {/* 写入与影响同一行，写入在左影响在右，形态照 v4 的 P03。
                            写入集是这次动了什么，影响是因此有什么不能再用，两件事不能混。 */}
                        <div className="history-detail-row">
                          {/* 认得出名字就列名字，认不出只说动了几条，不用 id 冒充名字 */}
                          {entry.subjectsZh.length
                            ? <span>写入：{entry.subjectsZh.join("、")}</span>
                            : <span className="gj-note">写入：{entry.writeCount} 条记录</span>}
                          {entry.impact && (entry.impact.total > 0
                            ? <span className="history-impact">影响：{entry.impact.groups.map((group) => `${group.kind} ${group.count}`).join("、")}</span>
                            : <span className="gj-note">无下游受影响</span>)}
                        </div>
                        {entry.reasonZh && <small>理由：{entry.reasonZh}</small>}
                        {!entry.reasonZh && <small className="gj-note">未记录理由</small>}
                        {entry.impact?.preserved.length ? (
                          <small className="gj-note">已交付版本保留：{entry.impact.preserved.map((group) => `${group.kind} ${group.count}`).join("、")}</small>
                        ) : null}
                        {entry.impact?.coverageGaps.length ? (
                          <small className="inline-warning">这次算不全：{entry.impact.coverageGaps.join("；")}</small>
                        ) : null}
                      </div>
                      <div className="history-who">
                        <small>操作人 {entry.actorId.slice(0, 8)}</small>
                        {entry.outcome !== "committed" && <small className="inline-warning">{entry.outcome}</small>}
                      </div>
                    </article>
                  ))}
                  {!changeHistory.length && <div className="panel-empty">这个项目还没有写入记录。每一次写入都会留在这里，含时间、操作人、改了什么和为什么。</div>}
                </div>
                </>, "选择左侧记录查看对应资料。")}
              </section>
            )}

            {activeStage === "candidates" && (
              <section className="evidence-board candidate-board">
                <header className="board-heading">
                  <div><h3>AI 候选与真实运行记录</h3></div>
                  <button className="gj-btn gj-btn--primary" type="button" disabled={!parsedEvidenceCount || Boolean(modelRunning) || !serverStatus?.modelConfigured} onClick={() => void runModel()}>
                    <Play size={14} /> {modelRunning ? "运行中" : "生成资料候选"}
                  </button>
                </header>
                <div className="pane-body">
                {/* 这句必须与实际行为一致。构件识别要把图片本身送出去，原来那句
                    只把文字发出去、原文件不上传，在构件识别接入后就不成立了。 */}
                <div className="transmission-note"><ShieldCheck size={15} /><span>{readableDrawingEvidenceIds.length
                  ? "本项目有图像资料，识别时会把这些图片发给助手。其余原文件保存在本机，不发送。"
                  : "只把本项目已识别出的文字发给助手核对。照片、图纸等原文件保存在本机，不会上传。"}</span></div>
                {!serverStatus?.modelConfigured && <p className="inline-warning">服务端尚未配置 KIMI_API_KEY，真实运行按钮已锁定。</p>}
                {!parsedEvidenceCount && <p className="inline-warning">先上传一份可解析的 UTF-8 文本或 JSON 资料。</p>}
                <div className="candidate-list">
                  {selected.snapshot.candidates.map((candidate) => (
                    <article className="candidate-card" key={candidate.id}>
                      <div className="candidate-meta"><span className="producer-badge model">模型</span><span>{REVIEW_LABELS[candidate.reviewStatus] ?? candidate.reviewStatus}</span></div>
                      <h4>{candidate.structured?.summary ?? "模型返回了未结构化候选"}</h4>
                      {candidate.structured?.kind === "evidenceSummary" && !!candidate.structured.findings.length
                        && <div><strong>资料发现</strong><ul>{candidate.structured.findings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                      {/* 图纸尺寸转写：读准的与读不准的分开列，读不准的由人工判断，不由模型替人决定 */}
                      {candidate.structured?.kind === "measurementTranscription" && (["certain", "uncertain"] as const).map((certainty) => {
                        const rows = candidate.structured?.kind === "measurementTranscription"
                          ? candidate.structured.dimensions.filter((item) => item.certainty === certainty)
                          : [];
                        if (!rows.length) return null;
                        return (
                          <div key={certainty}>
                            <strong>{certainty === "certain" ? `读出的尺寸 ${rows.length} 条` : `需要你确认的 ${rows.length} 条`}</strong>
                            <ul>{rows.map((row) => (
                              <li key={`${row.evidenceRef}:${row.valueText}:${row.locationZh ?? ""}`}>
                                {row.partZh ?? "部位待确认"} {row.valueText}
                                {row.valueMm ? `（${row.valueMm} mm）` : ""}
                                <small>{evidenceTitle(row.evidenceRef)}{row.locationZh ? ` · ${row.locationZh}` : ""}{row.noteZh ? ` · ${row.noteZh}` : ""}</small>
                              </li>
                            ))}</ul>
                          </div>
                        );
                      })}
                      {/* 构件识别：确定的与不确定的分开列。不确定的连疑点一起显示，
                          由人核实原图，不进这一批写入。 */}
                      {candidate.structured?.kind === "componentRecognition" && (["certain", "uncertain"] as const).map((certainty) => {
                        const rows = candidate.structured?.kind === "componentRecognition"
                          ? candidate.structured.components.filter((item) => item.certainty === certainty)
                          : [];
                        if (!rows.length) return null;
                        return (
                          <div key={certainty}>
                            <strong>{certainty === "certain" ? `认出的构件 ${rows.length} 个` : `需要你核实的 ${rows.length} 个`}</strong>
                            <ul>{rows.map((row, index) => (
                              <li key={`${row.evidenceRef}:${row.nameZh}:${index}`}>
                                {row.nameZh}{row.categoryZh ? ` · ${row.categoryZh}` : " · 类别待确认"}
                                <small>{evidenceTitle(row.evidenceRef)} 上 {(row.region.x * 100).toFixed(1)}%、{(row.region.y * 100).toFixed(1)}% 起，宽 {(row.region.width * 100).toFixed(1)}%、高 {(row.region.height * 100).toFixed(1)}%{row.noteZh ? ` · ${row.noteZh}` : ""}</small>
                              </li>
                            ))}</ul>
                          </div>
                        );
                      })}
                      {!!candidate.structured?.missingInformation.length && <div><strong>缺失信息</strong><ul>{candidate.structured.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                      {candidate.structured?.kind === "componentRecognition" && candidate.reviewStatus === "unreviewed" && (
                        <button className="gj-btn" type="button" onClick={() => void confirmRecognizedComponents(candidate)}>
                          确认认出的构件并写入项目
                        </button>
                      )}
                      {candidate.structured?.kind === "measurementTranscription" && candidate.reviewStatus === "unreviewed" && (
                        <button className="gj-btn" type="button" onClick={() => void confirmTranscribedDimensions(candidate)}>
                          确认读准的尺寸并写入项目
                        </button>
                      )}
                    </article>
                  ))}
                  {!selected.snapshot.candidates.length && <div className="panel-empty">助手的识别结果只进入待确认区，需要你确认后才写入项目。</div>}
                </div>
                {!!modelCostView.rows.length && <div className="run-ledger"><strong>运行账本与用量</strong>{modelCostView.rows.map((run) => <span key={run.runId}><b>{run.provider} / {run.model}</b><i>{run.status} · attempt {run.attempts}</i><em>{run.totalTokens ?? "—"} tokens · {run.costLabel}</em></span>)}<small>累计 {modelCostView.totalTokens} tokens{modelCostView.totalCost ? `，合计 ${formatCost(modelCostView.totalCost)}` : ""}。{modelCostView.priceSourcesZh.length ? `单价出处：${modelCostView.priceSourcesZh.join("；")}。` : "单价表里没有本次用到的模型，未估算费用。"}费用按用量与公开单价算得，仅供参考，以服务商账单为准。</small></div>}
                </div>
              </section>
            )}


        </ProjectPageFrame>
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
    {showCreate && (
      <Dialog title="建立项目档案" onClose={() => setShowCreate(false)}>
        <form className="gj-stack" onSubmit={(event) => void handleCreate(event)}>
          <Field label="项目名称" required><input name="name" required maxLength={200} placeholder="例如：城隍庙山门保护记录" /></Field>
          <Field label="建筑名称" required><input name="buildingName" required maxLength={200} placeholder="例如：山门" /></Field>
          <Field label="地点"><input name="locationText" maxLength={500} placeholder="可暂时留空" /></Field>
          <div className="gj-dialog-actions">
            <Button onClick={() => setShowCreate(false)}>取消</Button>
            <Button variant="primary" type="submit">创建并进入项目</Button>
          </div>
        </form>
      </Dialog>
    )}
    </>
  );
}
