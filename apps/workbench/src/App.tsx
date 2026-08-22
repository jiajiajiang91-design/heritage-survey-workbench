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
import { ComponentList } from "./screens/ComponentList";
import { ConditionRecord } from "./screens/ConditionRecord";
import { EvidenceList } from "./screens/EvidenceList";
import { MeasurementBaseline } from "./screens/MeasurementBaseline";
import { ModelView } from "./screens/ModelView";
import { ProjectList } from "./screens/ProjectList";
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
              <section className="evidence-board issue-board">
                <header className="board-heading">
                  <div><h3>问题队列与必要人工节点</h3></div>
                  <span className="issue-count">{openIssues.length} 个待处理</span>
                </header>
                <div className="pane-body">
                <div className="provenance-legend" aria-label="来源图例">
                  <span className="producer-badge model">模型候选</span>
                  <span className="producer-badge rule">规则结果</span>
                  <span className="producer-badge human">人工决定</span>
                  <span className="producer-badge demo">演示数据</span>
                </div>
                {humanInterventions && <div className="human-node-summary"><article><strong>{humanInterventions.missingFieldFacts.length}</strong><span>现场事实缺失</span></article><article><strong>{humanInterventions.professionalChoices.length}</strong><span>非唯一专业选择</span></article><article><strong>{humanInterventions.groupedReviewRefs.length}</strong><span>成组审核 / 交付</span></article><small>规则确定项自动执行，不增加逐项确认。</small></div>}
                {!confirmedTask ? (
                  <form className="task-setup" onSubmit={(event) => void submitTaskForm(event)}>
                    <div><span className="node-label">人工节点</span><h4>确认任务要求</h4><p>成果范围、适用规范和责任人只在任务开始时确认一次。之后能自动判断的检查会直接执行，不再逐项打扰你。</p></div>
                    <label>任务名称<input name="taskName" required defaultValue="资料整理与成果核对" /></label>
                    <label>任务范围（每行一项）<textarea name="scope" required defaultValue={"整理原始资料\n核对构件\n处理资料缺失\n导出成果"} /></label>
                    <label>适用规范或项目约定<textarea name="regulations" defaultValue="资料需注明来源，可追溯到原件" /></label>
                    <label>成果目录（每行一项）<textarea name="deliverables" required placeholder="按本次任务要求逐行填写，不套用模板" /></label>
                    <label>图纸标题<input name="drawingTitle" required /></label>
                    <label>修订标记<input name="drawingRevision" required placeholder="例如 P1" /></label>
                    <label>需要出图的构件类型（每行一项）<textarea name="geometryTargetRoles" required placeholder="例如 柱、墙、屋面；缺一项该图就不生成" /></label>
                    <label>图幅设置<textarea name="drawingSheets" required placeholder='逐张图填写图号、图名和图幅尺寸，例如：[{"key":"sheet-1","drawingNumber":"P-01","displayLabelZh":"平面与立面","pageMm":[841,594]}]' /></label>
                    <label>视图设置<textarea name="drawingViews" required placeholder="逐个视图填写图种、比例、所在图幅、在图上的位置、朝向和对应构件。详图还需指明依据的资料，缺依据则不生成" /></label>
                    <button className="gj-btn gj-btn--primary" type="submit">确认任务要求，开始整理资料</button>
                  </form>
                ) : (
                  <>
                    <div className="task-summary"><span className="node-label complete">任务要求已确认</span><strong>{confirmedTask.name}</strong><small>{confirmedTask.scope.join(" · ")}</small></div>
                    <details className="task-setup">
                      <summary>更新当前版本的成果要求</summary>
                      <form onSubmit={(event) => void submitTaskForm(event)}>
                        <label>任务名称<input name="taskName" required defaultValue={confirmedTask.name} /></label>
                        <label>任务范围<textarea name="scope" required defaultValue={confirmedTask.scope.join("\n")} /></label>
                        <label>适用规范<textarea name="regulations" defaultValue={confirmedTask.regulationRefs.join("\n")} /></label>
                        <label>成果目录<textarea name="deliverables" required defaultValue={confirmedTask.deliverables.join("\n")} /></label>
                        <label>图纸标题<input name="drawingTitle" required defaultValue={confirmedTask.artifactRequirements?.titleZh ?? ""} /></label>
                        <label>修订标记<input name="drawingRevision" required defaultValue={confirmedTask.artifactRequirements?.revisionLabel ?? "P1"} /></label>
                        <label>几何目标角色<textarea name="geometryTargetRoles" required defaultValue={confirmedTask.artifactRequirements?.geometryTargetRoles.join("\n") ?? ""} /></label>
                        <label>图纸结构 JSON<textarea name="drawingSheets" required defaultValue={JSON.stringify(confirmedTask.artifactRequirements?.sheets ?? [], null, 2)} /></label>
                        <label>视图结构 JSON<textarea name="drawingViews" required defaultValue={JSON.stringify(confirmedTask.artifactRequirements?.views ?? [], null, 2)} /></label>
                        <button className="gj-btn gj-btn--primary" type="submit">保存新任务版本</button>
                      </form>
                    </details>
                  </>
                )}
                <div className="issue-list">
                  {openIssues.filter((issue) => issue.sourceRef !== "rule:task-setup-required").map((issue) => {
                    const candidate = selected.snapshot.candidates.find((item) => issue.subjectRefs.includes(item.id));
                    const canDecide = issue.sourceRef === "rule:model-candidate-review" && candidate?.reviewStatus === "unreviewed";
                    return (
                      <article className="issue-card" key={issue.id}>
                        <div className="issue-meta"><span className={`issue-severity ${issue.issueType}`}>{ISSUE_TYPE_LABELS[issue.issueType] ?? issue.issueType}</span><span className="producer-badge rule">自动核对</span></div>
                        <h4>{issue.description}</h4>
                        {issue.options?.length ? (
                          <div className="decision-actions option-decision">
                            <p>下面几种做法都有依据。选定一种并写明理由，后续版本仍可改。</p>
                            {issue.options.map((option) => (
                              <label className="option-row" key={option.optionId}>
                                <input
                                  type="radio"
                                  name={`issue-option-${issue.id}`}
                                  checked={selectedOptions[issue.id] === option.optionId}
                                  onChange={() => setSelectedOptions((current) => ({ ...current, [issue.id]: option.optionId }))}
                                />
                                <span><strong>{option.labelZh}</strong><small>{option.valueText}</small><em>{option.sourceText}</em></span>
                              </label>
                            ))}
                            <label>理由或备注<textarea value={decisionReasons[issue.id] ?? ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [issue.id]: event.target.value }))} placeholder="选定时可选填；暂不选择时必填" /></label>
                            <div>
                              <button type="button" className="accept-decision" onClick={() => void decideIssueOptionFromForm(issue.id, "accepted")}>选定该方案</button>
                              <button type="button" className="reject-decision" onClick={() => void decideIssueOptionFromForm(issue.id, "rejected")}>暂不选择</button>
                            </div>
                          </div>
                        ) : canDecide ? (
                          <div className="decision-actions">
                            <p>这是非唯一的专业取舍，需要一次人工决定。接受只改变候选核对状态，不改变数据来源。</p>
                            <label>驳回理由<textarea value={decisionReasons[issue.id] ?? ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [issue.id]: event.target.value }))} placeholder="仅在驳回时必填" /></label>
                            <div>
                              <button type="button" className="accept-decision" onClick={() => void decideCandidateFromForm(issue.id, candidate.id, "accepted")}>接受为已核对候选</button>
                              <button type="button" className="reject-decision" onClick={() => void decideCandidateFromForm(issue.id, candidate.id, "rejected")}>驳回候选</button>
                            </div>
                          </div>
                        ) : (
                          <p className="auto-guidance">{issue.issueType === "missingEvidence" ? "补充或更换资料后，规则会自动复检，不需要手动确认。" : "由对应候选处理动作关闭。"}</p>
                        )}
                      </article>
                    );
                  })}
                  {!openIssues.filter((issue) => issue.sourceRef !== "rule:task-setup-required").length && confirmedTask && <div className="panel-empty">当前没有需要人工处理的异常。自动规则已完成。</div>}
                </div>
                {!!selected.snapshot.evidences.length && (
                  <form className="task-setup dimension-chain-form" onSubmit={(event) => void confirmDocumentedDimensionChain(event)}>
                    <div><span className="node-label">事实转写</span><h4>文档尺寸链核对</h4><p>只转写当前项目资料中的数值。系统自动计算差值；人工转写不等于现场测量。</p></div>
                    <label>总尺寸 mm<input name="totalWidthMm" type="number" min="1" step="any" required /></label>
                    <label>分段尺寸 mm<textarea name="segmentWidthsMm" required placeholder="例如：4200, 3600, 3600" /></label>
                    <label className="check-label"><input name="measurementMetadataComplete" type="checkbox" />资料已明确测量人、时间、方法和原始记录</label>
                    <button className="gj-btn gj-btn--primary" type="submit">转写并自动核对</button>
                  </form>
                )}
                <div className="workflow-ledgers">
                  <section><strong>规则运行</strong>{projectRuleRuns.slice(-4).reverse().map((run) => <span key={run.id}><b className="producer-badge rule">规则</b>{run.ruleSetVersion} · {run.results.filter((result) => result.outcome === "issue").length} 项异常</span>)}</section>
                  <section><strong>人工决定</strong>{projectDecisions.slice(-4).reverse().map((decision) => {
                    const issue = selected.snapshot.issues.find((item) => item.id === decision.issueId);
                    const candidate = selected.snapshot.candidates.find((item) => decision.impactRefs.includes(item.id));
                    const target = candidate
                      ? `模型候选 ${candidate.taskType}`
                      : decision.selectedOptionId ? `所选方案 ${decision.selectedOptionId}` : issue?.sourceRef ?? "项目";
                    return (
                      <span key={decision.id}>
                        <b className="producer-badge human">人工</b>{decision.outcome} · {decision.decidedAt.slice(0, 19).replace("T", " ")}
                        <small>对象：{target}{issue ? ` · 问题：${issue.description.slice(0, 24)}` : ""}</small>
                      </span>
                    );
                  })}{!projectDecisions.length && <small>尚无人工决定</small>}</section>
                </div>
                </div>
              </section>
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
              <section className="evidence-board">
                <header className="board-heading">
                  <div><h3>图幅、视图与图签</h3></div>
                  <button className="gj-btn gj-btn--text" type="button" onClick={() => setActiveStage("tasks")}>在任务要求中修改</button>
                </header>
                {confirmedTask?.artifactRequirements ? (() => {
                  const requirements = confirmedTask.artifactRequirements;
                  return (
                    <div className="pane-body">
                        <div className="summary-grid">
                          <article><span>图纸标题</span><strong>{requirements.titleZh}</strong><small>修订标记 {requirements.revisionLabel}</small></article>
                          <article><span>图幅</span><strong>{requirements.sheets.length} 张</strong><small>{[...new Set(requirements.sheets.map((sheet) => `${sheet.pageMm[0]}×${sheet.pageMm[1]}`))].join(" · ")} mm</small></article>
                          <article><span>视图</span><strong>{requirements.views.length} 个</strong><small>比例 {[...new Set(requirements.views.map((view) => `1:${view.scaleDenominator}`))].join(" · ")}</small></article>
                        </div>
                        <div className="requirements-table">
                          {requirements.sheets.map((sheet) => (
                            <div key={sheet.key}>
                              <span>{sheet.drawingNumber}</span>
                              <strong>{sheet.displayLabelZh}</strong>
                              <span>{sheet.pageMm[0]}×{sheet.pageMm[1]}</span>
                              <span>{requirements.views.filter((view) => view.sheetKey === sheet.key).length} 个视图</span>
                            </div>
                          ))}
                        </div>
                        <div className="requirements-table">
                          {requirements.views.map((view) => (
                            <div key={view.key}>
                              <span>{view.drawingRef}</span>
                              <strong>{view.displayLabelZh}</strong>
                              <span>{DRAWING_KIND_LABELS[view.kind] ?? view.kind}</span>
                              <span>1:{view.scaleDenominator}</span>
                            </div>
                          ))}
                        </div>
                        <div className="inline-warning">构件画法与标注规则暂时不能选择。当前每张图只标注一道总尺寸和图名，轴线、标高、剖切索引和构件名称都还没有生成。等这部分做好后，这里会开放画法与标注的选项。</div>
                      <aside className="stage-evidence" aria-label="样式预览">
                        <header><strong>图面预览</strong>{drawingPreviewUrls.length > 0 && <small>{drawingPreviewUrls[0]!.label}</small>}</header>
                        {drawingPreviewUrls.length > 0
                          ? (drawingPreviewUrls[0]!.kind === "svg"
                            ? <img src={drawingPreviewUrls[0]!.url} alt="图纸样式预览" />
                            : <object data={drawingPreviewUrls[0]!.url} type="application/pdf" aria-label="图纸样式预览" />)
                          : <div className="panel-empty">生成成组图纸后，这里显示应用当前版面的实际图面。</div>}
                      </aside>
                    </div>
                  );
                })() : <div className="panel-empty">尚未确认成果要求。图幅、视图与图签在任务要求中一次确认后显示在这里。</div>}
              </section>
            )}

            {activeStage === "drawings" && (
              <section className="evidence-board drawing-board">
                <header className="board-heading">
                  <div><h3>成组平立剖与节点详图</h3></div>
                  <QualificationChip />
                  <button className="gj-btn gj-btn--primary gj-btn--loadable" type="button" aria-busy={drawingRunning} disabled={!geometryRevision || !confirmedTask || drawingRunning} onClick={() => void generateDrawings()}>
                    <Images size={14} /> 按成果目录生成
                  </button>
                </header>
                <div className="pane-body">
                {showDrawingTask && (
                  <LongTask labelZh={`正在生成成组图纸：${cadPhaseLabel(drawingProgress)}`} onCancel={() => void cancelDrawings()} cancelling={drawingCancelling} />
                )}
                <div className="transmission-note"><ShieldCheck size={15} /><span>图种、图幅和版面来自任务要求；图上每条线都由当前三维模型剖切或投影得到，不另外描画。</span></div>
                {drawingArtifacts.length > 0 && <DrawingLimitationNote />}
                {drawingArtifacts.length ? (
                  <><div className="drawing-preview-grid" aria-label="成组图纸预览">
                    {drawingPreviewUrls.map((preview) => preview.kind === "svg"
                      ? <figure key={preview.id}><img src={preview.url} alt={`${preview.label} 矢量预览`} /><figcaption>{preview.label}</figcaption></figure>
                      : <figure key={preview.id}><object data={preview.url} type="application/pdf" aria-label={`${preview.label} PDF 预览`} /><figcaption>{preview.label}</figcaption></figure>)}
                  </div><div className="artifact-list">
                    {drawingArtifacts.map((artifact) => <button type="button" key={artifact.id} onClick={() => void downloadArtifact(artifact)}><span>{artifact.kind}</span><strong>{artifact.fileName}</strong><small>{Math.round(artifact.byteLength / 1024)} KB</small></button>)}
                  </div></>
                ) : <div className="panel-empty">先生成三维模型，再按任务要求出图。图纸会同时导出 DXF、PDF 和预览图。</div>}
                {latestCheckRun && <div className="check-summary"><FileCheck2 size={18} /><div><strong>检查结果</strong>{latestCheckRun.results.map((item) => <p key={item.code} className={item.outcome}>{item.outcome === "passed" ? "通过" : "不通过"} · {item.message}</p>)}</div></div>}
                </div>
              </section>
            )}

            {activeStage === "checks" && (
              <section className="evidence-board checks-board">
                <header className="board-heading"><div><h3>检查结果与待确认项</h3></div><QualificationChip /></header>
                <div className="pane-body">
                <div className="summary-grid">
                  <article><span>三维模型</span><strong>{geometryRevision ? "已生成" : "未生成"}</strong><small>{geometrySpec?.unknowns.length ?? 0} 项待确认</small></article>
                  <article><span>当前成果</span><strong>{artifactSetView?.currentArtifacts.length ?? 0} 项</strong><small>{artifactSetView?.crossRevisionArtifactCount ?? 0} 项旧版本成果已隔离</small></article>
                  <article><span>检查结论</span><strong>{latestCheckRun ? latestCheckRun.results.filter((result) => result.outcome === "blocked").length ? "有不通过项" : "全部通过" : "尚未检查"}</strong><small>技术检查通过不等于专业复核通过</small></article>
                </div>
                {latestCheckRun ? <div className="check-register">{latestCheckRun.results.map((result) => <article key={result.code} className={result.outcome}><span>{result.outcome === "passed" ? "通过" : "不通过"}</span><strong>{describeBlocker(result.code)}</strong><p>{result.message}</p></article>)}</div> : <div className="panel-empty">还没有检查记录。检查通过不等于专业复核通过，签发仍需责任人操作。</div>}
                {!!blockerReasons.length && <div className="delivery-blockers"><strong>暂时不能正式交付</strong>{blockerReasons.map((reason) => <p key={reason}>{reason}</p>)}</div>}
                </div>
              </section>
            )}

            {activeStage === "package" && (
              <section className="evidence-board package-board">
                <header className="board-heading"><div><h3>代理成果交付与项目包</h3></div><button className="gj-btn gj-btn--primary" type="button" disabled={!geometryRevision || !latestCheckRun || !drawingArtifacts.length || Boolean(latestDelivery)} onClick={() => void createProxyDelivery()}><PackageOpen size={14} /> 建立代理交付草案</button></header>
                <div className="pane-body">
                {latestDelivery ? <div className="delivery-status"><QualificationChip /><strong>交付草案已建立</strong><p>{latestDelivery.restrictions.join(" · ")}</p></div> : deliveryBlockers.length ? <div className="delivery-blockers"><strong>暂时不能正式交付</strong>{deliveryBlockers.map((item) => <p key={item}>{item}</p>)}<button type="button" disabled={Boolean(latestBlockedDelivery)} onClick={() => void recordBlockedDelivery()}>{latestBlockedDelivery ? "已记录原因" : "记录无法交付的原因"}</button></div> : null}
                {showExportTask && (
                  <LongTask labelZh={`正在导出项目包：${exportProgress?.phase ?? ""}`} onCancel={cancelExport} cancelling={exportProgress?.cancelling ?? false} />
                )}
                <div className="package-grid">
                  <article><FileJson /><strong>project.json</strong><p>适合检查结构化记录，不包含二进制文件本体。</p><button className="gj-btn gj-btn--secondary gj-btn--loadable" type="button" aria-busy={Boolean(exportProgress)} disabled={Boolean(exportProgress)} onClick={() => void downloadProject("json")}>导出 JSON</button></article>
                  <article><PackageOpen /><strong>project.gujian.zip</strong><p>包含全部资料原件、识别与核对记录、人工决定、三维模型、图纸、检查结果和交付草案。</p><button className="gj-btn gj-btn--secondary gj-btn--loadable" type="button" aria-busy={Boolean(exportProgress)} disabled={Boolean(exportProgress)} onClick={() => void downloadProject("zip")}>导出代理 ZIP</button></article>
                </div>
                <section className="roundtrip-check">
                  <div>
                    <ShieldCheck size={17} />
                    <span><strong>导出后能否完整恢复</strong><small>用当前项目实时导出一份，在一个独立环境里恢复并逐项核对资料、记录与成果。检验不改动本机项目，结束后自动清理。</small></span>
                  </div>
                  <button className="gj-btn gj-btn--secondary" type="button" onClick={() => void verifyEmptyLibraryRoundTrip()}>检验导出与恢复</button>
                  {roundTripReceipt && (
                    <dl aria-label="恢复检验结果">
                      
                      
                      
                      <div><dt>资料</dt><dd>{roundTripReceipt.evidenceCount}</dd></div>
                      <div><dt>规则</dt><dd>{roundTripReceipt.ruleRunCount}</dd></div>
                      <div><dt>人工决定</dt><dd>{roundTripReceipt.decisionCount}</dd></div>
                      <div><dt>几何版本</dt><dd>{roundTripReceipt.geometryRevisionCount}</dd></div>
                      <div><dt>成果</dt><dd>{roundTripReceipt.artifactCount}</dd></div>
                      <div><dt>检查</dt><dd>{roundTripReceipt.checkRunCount}</dd></div>
                      <div><dt>交付</dt><dd>{roundTripReceipt.deliveryCount}</dd></div>
                      <div><dt>项目记录</dt><dd>{roundTripReceipt.jsonEvidenceCount} 份资料，全部原文件另存于 ZIP 包</dd></div>
                      
                      
                    </dl>
                  )}
                </section>
                </div>
              </section>
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
