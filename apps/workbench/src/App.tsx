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
import { ProjectList } from "./screens/ProjectList";
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
              <section className="evidence-board task-overview-board">
                <header className="board-heading"><div><h3>任务要求与成果目录</h3></div><button className="gj-btn gj-btn--text" type="button" onClick={() => setActiveStage("issues")}>在问题流程中更新</button></header>
                <div className="pane-body">
                {confirmedTask ? <>
                  <div className="summary-grid">
                    <article><span>任务</span><strong>{confirmedTask.name}</strong><small>{confirmedTask.scope.join(" · ")}</small></article>
                    <article><span>成果要求</span><strong>{confirmedTask.artifactRequirements?.views.length ?? 0} 个视图</strong><small>{confirmedTask.artifactRequirements?.sheets.length ?? 0} 张图纸 · 修订 {confirmedTask.artifactRequirements?.revisionLabel ?? "未定"}</small></article>
                    <article><span>规范依据</span><strong>{confirmedTask.regulationRefs.length} 项</strong><small>{confirmedTask.regulationRefs.join(" · ") || "尚未登记"}</small></article>
                  </div>
                  <div className="requirements-table" role="table" aria-label="成果目录">
                    {confirmedTask.artifactRequirements?.views.map((view) => <div role="row" key={view.key}><span>{view.drawingRef}</span><strong>{view.displayLabelZh}</strong><span>1:{view.scaleDenominator}</span><span>{view.sheetKey}</span></div>)}
                  </div>
                </> : <div className="panel-empty">尚未确认任务要求。系统会在问题队列中保留一次必要人工节点，不会用默认图种或版式补齐。</div>}
                </div>
              </section>
            )}

            {activeStage === "evidence" && (
              <section className="evidence-board">
                <header className="board-heading">
                  <div><h3>原始资料与解析记录</h3></div>
                  {/* 读图提取尺寸：结果进待确认区，人工核对后才写入项目 */}
                  {!!readableDrawingEvidenceIds.length && (
                    <button className="gj-btn" type="button" disabled={Boolean(modelRunning)} onClick={() => void transcribeDrawings()}>
                      <Ruler size={14} /> 从图纸读尺寸
                    </button>
                  )}
                  <button className="gj-btn gj-btn--primary" type="button" onClick={() => evidenceInput.current?.click()}><Upload size={14} /> 上传原始资料</button>
                  <input ref={evidenceInput} className="sr-only" type="file" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadFromInput(files); }} />
                </header>
                {renderSplit(<>
                    <div className="evidence-list">
                      {selected.snapshot.evidences.map((evidence) => {
                        const parse = selected.snapshot.parseRecords.find((record) => record.evidenceId === evidence.id);
                        return (
                          <article className={`evidence-card ${activeEvidenceId === evidence.id ? "active" : ""}`} key={evidence.id}
                            onClick={() => setActiveEvidenceId(evidence.id)}>
                            <span className="evidence-type">{EVIDENCE_TYPE_LABELS[evidence.evidenceType] ?? evidence.evidenceType}</span>
                            <div><strong>{evidence.title}</strong><small>{parse ? PARSE_STATUS_LABELS[parse.status] ?? "尚未读取" : "尚未读取"}</small></div>
                            <span className={`data-status ${evidence.dataStatus}`}>{DATA_STATUS_LABELS[evidence.dataStatus] ?? evidence.dataStatus}</span>
                            <button className="gj-btn gj-btn--text" type="button" onClick={(event) => { event.stopPropagation(); void downloadEvidence(evidence.assetId); }}>原文件</button>
                          </article>
                        );
                      })}
                      {!selected.snapshot.evidences.length && (
                        <div className="evidence-empty"><div className="trace-spine" aria-hidden="true"><span /><span /><span /><span /></div><p>上传任务书、照片、测量记录或已有图纸。文件本体、证据记录和解析结果会一起进入项目版本。</p></div>
                      )}
                    </div>

                </>, "选择左侧资料查看原件。")}
              </section>
            )}

            {activeStage === "measurements" && (
              <section className="evidence-board">
                <header className="board-heading"><div><h3>测量记录、事实与缺失影响</h3></div><span className="board-count">{selected.snapshot.measurements.length + selected.snapshot.facts.length} 条记录</span></header>
                {renderSplit(<>
                {projectArchetypes.length ? (() => {
                  const archetype = projectArchetypes[projectArchetypes.length - 1]!;
                  const derivation = deriveArchetypeExpectations(archetype);
                  const comparisons = compareWithMeasuredFacts(derivation, selected.snapshot.facts);
                  return (
                    <div className="archetype-comparison">
                      <h4>按形制推算的尺寸与实测对照</h4>
                      <p>采用{LIFT_RATIO_SET_LABELS[derivation.ruleSetId] ?? derivation.ruleSetId}，柱位 {derivation.layout.pillarCount} 处，枋连接 {derivation.layout.fangCount} 处。推算值只作核对参考，实测记录始终优先，也不能作为图纸标注依据。</p>
                      <div className="record-table">
                        {comparisons.map((item) => (
                          <article key={item.dimension}>
                            <strong>{item.dimension}</strong>
                            <span>推算 {item.valueMm !== null ? `${item.valueMm} mm` : "按实际测量"}{item.toleranceText ? `，允许偏差 ${item.toleranceText}` : ""}</span>
                            <span>实测 {item.measuredMm !== null ? `${item.measuredMm} mm` : "尚无实测记录"}</span>
                            <small>{item.deltaMm !== null ? `相差 ${item.deltaMm} mm${item.withinTolerance === null ? "" : item.withinTolerance ? "，在允许偏差内" : "，超出允许偏差，建议记入现状"}` : "缺实测，无法比较"}</small>
                            <small>{item.sourceText}</small>
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })() : (
                  <form className="task-setup archetype-form" onSubmit={(event) => void registerArchetype(event)}>
                    <div><span className="node-label">人工节点</span><h4>登记形制，用于核对实测</h4><p>填写开间、进深和举架做法后，系统按形制推算各处尺寸，供你与实测比对。实测记录始终优先，差异较大的项会提示记入现状。</p></div>
                    <label>逐间面阔 mm（逗号分隔）<input name="bayX" required placeholder="例如 4800" /></label>
                    <label>逐间进深 mm（逗号分隔）<input name="bayY" required placeholder="例如 1800,1800" /></label>
                    <label>步架数<input name="stepCount" type="number" min="1" max="20" required placeholder="七檩填 3" /></label>
                    <label>斗口或材宽 mm<input name="baseD" type="number" min="1" step="any" required placeholder="例如 380" /></label>
                    <label>举架做法
                      <select name="liftRatioSetRef" defaultValue="qing-gongcheng-zuofa">
                        <option value="qing-gongcheng-zuofa">清工程做法举架系数</option>
                        <option value="liang-drawings">梁思成图纸举架系数</option>
                      </select>
                    </label>
                    <label>柱位（列/行，逗号分隔）<input name="pillarNet" required placeholder="例如 0/0,0/1,1/0,1/1" /></label>
                    <label>枋连接的两根柱（可选）<input name="fangNet" placeholder="例如 0/0#1/0,0/1#1/1" /></label>
                    <label>形制判断依据<input name="sourceDeclaration" required placeholder="例如 现场踏勘并对照同期实例" /></label>
                    <button className="gj-btn gj-btn--primary" type="submit">登记并推算尺寸</button>
                  </form>
                )}
                <div className="record-table">
                  {selected.snapshot.measurements.map((measurement) => <article key={measurement.id}><span className={`producer-badge ${measurement.producer.producerType}`}>{PRODUCER_LABELS[measurement.producer.producerType]}</span><strong>{measurement.quantity.originalText} {measurement.quantity.originalUnit}</strong><small>{measurement.metadataStatus === "complete" ? "已记录测量人、时间和方法" : "缺测量人、时间或方法"}</small><small>{evidenceTitle(measurement.originalEvidenceRef)}</small></article>)}
                  {selected.snapshot.facts.map((fact) => <article key={fact.id}><span className={`producer-badge ${fact.producer.producerType}`}>{PRODUCER_LABELS[fact.producer.producerType]}</span><strong>{factFieldLabel(fact.field)}</strong><small>{REVIEW_LABELS[fact.reviewStatus] ?? fact.reviewStatus} · {DATA_STATUS_LABELS[fact.dataStatus] ?? fact.dataStatus}</small><small>{fact.evidenceRefs.map(evidenceTitle).join("、") || "未指明资料"}</small></article>)}
                  {!selected.snapshot.measurements.length && !selected.snapshot.facts.length && <div className="panel-empty">还没有可用的尺寸。尺寸缺失时，依赖它的成果不会生成，系统也不会用默认值补齐。</div>}
                </div>

                </>, "选择资料查看手写草图或测量记录原件。")}
              </section>
            )}

            {activeStage === "objects" && (
              <section className="evidence-board">
                <header className="board-heading"><div><h3>对象、构件与稳定标识</h3></div><span className="board-count">{geometrySpec?.objects.length ?? 0} 个对象{selected.snapshot.entities.length ? ` · ${selected.snapshot.entities.length} 条构件记录` : ""}</span></header>
                {renderSplit(<>
                <div className="object-table">
                  {(geometrySpec?.objects ?? []).map((object) => <button type="button" key={object.id} onClick={() => { setSelectedGeometryEntityId(object.id); setActiveStage("geometry"); }}><span>{object.displayNameZh}</span><small>{typeLabel(object.componentType, object.conceptRef)}</small><small>{PRODUCER_LABELS[object.producer.producerType]}</small><strong>{object.unknownRefs.length ? `${object.unknownRefs.length} 项待确认` : "来源已记录"}</strong></button>)}
                  {/* 记录级构件与几何对象并列显示，不是二选一。框选新增与识别确认写的是
                      记录级构件，项目一旦生成了几何就再也看不到它们，助手回报已新增而界面
                      毫无变化。两者来源不同，用标记分开，不合并计数。 */}
                  {selected.snapshot.entities.map((entity) => {
                    // 排除与遮挡都要在行上看得出来。用户说了去掉或看不见，
                    // 界面毫无变化就等于没执行。排除不删记录，只标出来。
                    const excluded = selected.snapshot.exclusionRecords.some((record) => record.originRef === entity.id);
                    return (
                      <article key={entity.id}>
                        <strong>{entity.name}</strong>
                        <span>{entity.entityType}</span>
                        <small>{ENTITY_ORIGIN_LABELS[entity.origin ?? "import"]}</small>
                        {excluded && <small className="entity-flag">已排除</small>}
                        {entity.visibility && <small className="entity-flag">不可见 · {entity.visibility.needsReshoot ? "需补拍" : "无需补拍"}</small>}
                        <small>{entity.locationText ?? "未记位置"}</small>
                      </article>
                    );
                  })}
                  {!geometrySpec?.objects.length && !selected.snapshot.entities.length && <div className="panel-empty">还没有构件。构件只能来自本项目的资料，或本项目已核对过的三维模型。</div>}
                </div>

                </>, "选择资料查看构件对应的照片。")}
              </section>
            )}

            {activeStage === "conditions" && (
              <section className="evidence-board">
                <header className="board-heading"><div><h3>空间关系、构造连接与可见残损</h3></div><span className="board-count">{selected.snapshot.observations.length} 条记录</span></header>
                {renderSplit(<>
                    <div className="record-table">
                      {selected.snapshot.relations.map((relation) => (
                        <article key={relation.id}>
                          <span className={`producer-badge ${relation.producer.producerType}`}>{PRODUCER_LABELS[relation.producer.producerType]}</span>
                          <strong>{relation.relationType}</strong>
                          <small>{relation.fromRef} 至 {relation.toRef}</small>
                          <small>{relation.evidenceRefs.map(evidenceTitle).join("、") || "未指明资料"}</small>
                        </article>
                      ))}
                      {selected.snapshot.observations.map((observation) => (
                        <article key={observation.id}>
                          <span className={`producer-badge ${observation.producer.producerType}`}>{PRODUCER_LABELS[observation.producer.producerType]}</span>
                          <strong>{OBSERVATION_LABELS[observation.observationType]}</strong>
                          <small>{observation.text}</small>
                          <small>{observation.evidenceRefs.map(evidenceTitle).join("、")}</small>
                        </article>
                      ))}
                      {!selected.snapshot.relations.length && !selected.snapshot.observations.length && (
                        <div className="panel-empty">还没有现状记录。构件之间的关系由助手识别、再由人工确认；残损情况需要对照资料逐条记录，不能凭推断填写。</div>
                      )}
                    </div>
                    {archetypeDifferences.length > 0 && (
                      <div className="inline-warning">有 {archetypeDifferences.length} 项实测尺寸超出按形制推算的允许偏差，建议记入现状：{archetypeDifferences.map((item) => item.dimension).join("、")}。</div>
                    )}
                    <form className="task-setup" onSubmit={(event) => void submitObservation(event)}>
                      <div><span className="node-label">人工节点</span><h4>记录一条现状判断</h4><p>只记录当前资料上可见的内容。不可见部位记为待复查，不写推断结论。</p></div>
                      <label>判断类型
                        <select name="observationType" defaultValue="visibleCondition">
                          <option value="visibleCondition">可见状态</option>
                          <option value="damage">残损</option>
                          <option value="material">材料</option>
                          <option value="state">整体状态</option>
                        </select>
                      </label>
                      <label>对象（留空即整栋建筑）<input name="subjectRef" placeholder="构件稳定标识或对象 id" /></label>
                      <label>依据资料
                        <select name="evidenceRef" required defaultValue={activeEvidenceId ?? ""}>
                          <option value="" disabled>选择一份资料</option>
                          {selected.snapshot.evidences.map((evidence) => <option key={evidence.id} value={evidence.id}>{evidence.title}</option>)}
                        </select>
                      </label>
                      <label>判断内容<textarea name="text" required placeholder="例如：西侧檐柱柱脚可见糟朽，范围约柱高下部三分之一" /></label>
                      <button className="gj-btn gj-btn--primary" type="submit" disabled={!selected.snapshot.evidences.length}>记录并绑定来源</button>
                    </form>

                </>, "选择资料查看对应部位照片。")}
              </section>
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
              <section className="evidence-board geometry-board">
                <header className="board-heading">
                  <div><h3>项目驱动三维模型</h3></div>
                  <button className="gj-btn gj-btn--primary gj-btn--loadable" type="button" aria-busy={geometryRunning} disabled={!geometryGate?.ready || geometryRunning} onClick={() => void generateDemoGeometry()}>
                    <Play size={14} /> {geometryRevision ? "生成新代理版本" : "生成代理几何"}
                  </button>
                </header>
                <div className="pane-body">
                {showGeometryTask && (
                  <LongTask labelZh={`正在生成三维模型：${cadPhaseLabel(cadProgress?.phase)}`} onCancel={() => void cancelGeometry()} cancelling={cadCancelling} />
                )}
                <div className="transmission-note"><ShieldCheck size={15} /><span>生成三维只使用本项目已确认的构件数据，不读取项目以外的文件。</span></div>
                {!geometryGate?.ready && (
                  <div className="geometry-gate">
                    <strong>建立代理几何前，需从当前项目资料逐构件确认几何事实</strong>
                    <p>每个构件和界面必须定位到当前项目具体证据；不得用百分比、固定厚度或其他项目数据补齐。当前缺失：{geometryGate?.missing.join("、")}</p>
                    {!!selected.snapshot.evidences.length && (
                      <form className="geometry-fact-form" onSubmit={(event) => void confirmGeometryFacts(event)}>
                        <label>构件数据<textarea name="geometryComponents" required placeholder="逐个构件填写：名称、类型、尺寸、依据的资料，以及尚未确认的部分" /></label>
                        <label>界面事实 JSON<textarea name="geometryInterfaces" required placeholder="仅填写图纸或调查资料可证明的承托、接触、包含或搭接关系；无证据可留空 []" /></label>
                        <p>当前项目证据 ID：{selected.snapshot.evidences.map((item) => `${item.title}=${item.id}`).join("；")}</p>
                        <button className="gj-btn gj-btn--primary" type="submit">写入逐构件证据事实</button>
                      </form>
                    )}
                  </div>
                )}
                {geometryRevision && geometryBlob ? (
                  <div className="geometry-workspace">
                    <GlbViewer blob={geometryBlob} onSelect={setSelectedGeometryEntityId} />
                    <aside className="geometry-inspector">
                      <QualificationChip />
                      <h4>{selectedGeometryEntity?.displayNameZh ?? "选择模型构件查看来源"}</h4>
                      {selectedGeometryEntity ? <>
                        <dl>
                          <div><dt>稳定键</dt><dd>{selectedGeometryEntity.stableKey}</dd></div>
                          <div><dt>构件类型</dt><dd>{typeLabel(selectedGeometryEntity.componentType, selectedGeometryEntity.conceptRef)}（{selectedGeometryEntity.componentType}）</dd></div>
                          <div><dt>来源</dt><dd>{PRODUCER_LABELS[selectedGeometryEntity.producer.producerType]}</dd></div>
                          <div><dt>证据</dt><dd>{selectedGeometryEntity.evidenceRefs.length} 项</dd></div>
                        </dl>
                        {selectedGeometryEntity.unknownRefs.map((id) => {
                          const unknown = geometrySpec?.unknowns.find((item) => item.id === id);
                          return unknown ? <div className="unknown-card" key={id}><p>{unknown.description}</p><small>{unknown.blocksFormalEligibility ? "影响正式交付" : "不影响正式交付"}</small></div> : null;
                        })}
                      </> : <p>点击模型中的构件，查看稳定 ID、证据引用、未知项和资格影响。</p>}
                      <hr />
                      <small>共 {geometrySpec?.objects.length ?? 0} 个构件</small>
                      <small>{geometrySpec?.objects.length ?? 0} 个实体 · {geometrySpec?.interfaces.length ?? 0} 个界面 · {geometrySpec?.unknowns.length ?? 0} 个未知项</small>
                    </aside>
                  </div>
                ) : (
                  <div className="panel-empty">还没有三维模型。生成后可在这里查看构件并核对来源。</div>
                )}
                </div>
              </section>
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
