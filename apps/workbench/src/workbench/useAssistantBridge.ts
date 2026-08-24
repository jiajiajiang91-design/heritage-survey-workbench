import { useEffect, useMemo, useRef, useState } from "react";

import type { ModificationProposal } from "../assistant/action-executors";
import { AssistantClient } from "../assistant/assistant-client";
import { runClientOp } from "../assistant/client-op-adapter";
import { buildWorkspaceSnapshot } from "../assistant/workspace-snapshot";
import { describeFailure } from "../failure-notice";
import { buildProvenanceGraphView } from "../query-models";
import { DATA_STATUS_LABELS, EVIDENCE_TYPE_LABELS, factFieldLabel } from "../labels";
import { factValueText } from "../screens/MeasurementBaseline";
import { isStageId, stageLabel } from "../view-registry";
import type { EvidencePane } from "./useEvidencePane";
import type { Jobs } from "./useJobs";
import type { Notices } from "./useNotices";
import type { ProjectSession } from "./useProjectSession";
import type { RecordWrites } from "./useRecordWrites";
import type { WorkspaceNav } from "./useWorkspaceNav";

interface BridgeDeps {
  session: ProjectSession;
  nav: WorkspaceNav;
  jobs: Jobs;
  evidence: EvidencePane;
  writes: RecordWrites;
  notices: Notices;
}

// 助手与工作台之间的桥：快照供给、clientOp 执行、修改建议的采纳与拒绝。
export function useAssistantBridge({ session, nav, jobs, evidence, writes, notices }: BridgeDeps) {
  const { setError, setNotice } = notices;
  const { selected, loadProject, openIssues, geometrySpec } = session;
  const { assistantExecutors } = writes;
  const assistantChatClient = useMemo(() => new AssistantClient(), []);
  const [pendingProposal, setPendingProposal] = useState<ModificationProposal | null>(null);

  // 项目现状（实施单元 09）：按真实数据写成一段中文给模型。只写数与名，不写判断。
  const contextZh = (() => {
    if (!selected) return "";
    const snapshot = selected.snapshot;
    const task = session.confirmedTask;
    const geometry = snapshot.geometryRevisions.at(-1) ?? null;
    const signoff = geometry ? snapshot.reviewSignoffs.find((item) => item.geometryRevisionId === geometry.id) ?? null : null;
    const evidences = snapshot.evidences.map((item) => `${item.title}（${EVIDENCE_TYPE_LABELS[item.evidenceType] ?? item.evidenceType}，${DATA_STATUS_LABELS[item.dataStatus] ?? item.dataStatus}）`);
    const openIssueLines = openIssues.slice(0, 6).map((item) => item.description.slice(0, 60));
    const views = task?.artifactRequirements?.views.map((view) => `${view.displayLabelZh} 1:${view.scaleDenominator}`) ?? [];
    const check = session.latestCheckRun;
    // 签发后，检查里要求专业复核一类的结果已由签发记录解除，不再算不通过
    const liftedCodes = new Set(signoff ? ["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", ...(signoff.l1Eligible ? ["L1_ELIGIBILITY_FALSE"] : [])] : []);
    const blocked = check ? check.results.filter((item) => item.outcome !== "passed" && !liftedCodes.has(item.code)).length : 0;
    return [
      `项目：${snapshot.project.name}；建筑：${snapshot.buildings[0]?.name ?? "未登记"}；地点：${snapshot.project.locationText ?? "未登记"}。`,
      `当前这一步：${stageLabel(nav.activeStage)}。`,
      `资料 ${snapshot.evidences.length} 份：${evidences.join("；") || "无"}。`,
      `尺寸记录 ${snapshot.facts.length} 条，其中已确认 ${snapshot.facts.filter((item) => item.reviewStatus === "confirmed").length} 条，待核实 ${snapshot.facts.filter((item) => item.dataStatus === "uncertain").length} 条。`,
      // 明细也要给：只给条数的话，用户问通面阔是多少，模型只能答现状里没写
      `尺寸明细：${snapshot.facts.slice(0, 40).map((item) => `${factFieldLabel(item.field)} ${factValueText(item.value)}`).join("；") || "无"}。`,
      `未关闭的问题 ${openIssues.length} 条${openIssueLines.length ? `：${openIssueLines.join("；")}` : ""}。`,
      `三维模型：${geometry ? `已生成，构件 ${geometrySpec?.objects.length ?? 0} 个，待确认部位 ${geometrySpec?.unknowns.length ?? 0} 处` : "未生成"}。`,
      `成果要求：${views.length ? views.join("、") : "未确认"}；成果文件 ${session.projectArtifacts.length} 项。`,
      `检查：${check ? (blocked ? `已检查 ${check.results.length} 项，${blocked} 项不通过` : `已检查 ${check.results.length} 项，全部通过`) : "未检查"}。`,
      `签发与归档：${signoff ? `${signoff.reviewerRole === "projectLead" ? "项目负责人" : "专业复核人"}已于 ${signoff.signedAt.slice(0, 10)} 复核签发，成果可正式交付，归档已完成；复核意见：${signoff.statementZh}` : session.projectDeliveries.length ? "有归档草案，未签发" : "无归档草案"}。`,
    ].join("\n");
  })();

  const buildAssistantSnapshot = () => buildWorkspaceSnapshot({
    projectId: selected?.projectId ?? null,
    currentStage: nav.activeStage,
    contextZh,
    openIssueCount: openIssues.length,
    entityCount: (geometrySpec?.objects.length ?? 0) + (selected?.snapshot.entities.length ?? 0),
    geometryRevisionCount: selected?.snapshot.geometryRevisions.length ?? 0,
    artifactCount: session.projectArtifacts.length,
    deliveryCount: session.projectDeliveries.length,
    serverModelConfigured: session.serverStatus?.modelConfigured ?? false,
    unparsedEvidenceCount: Math.max(0, (selected?.snapshot.evidences.length ?? 0) - session.parsedEvidenceCount),
    hasImageSelection: evidence.imageSelection !== null,
  });

  const handleAssistantClientOp = async (input: { clientOp: string; actionName: string; args: unknown }) => {
    const outcome = await runClientOp({
      executors: assistantExecutors,
      getHead: () => selected,
      getOpenDockItems: () => openIssues.length,
      knownRefs: () => [
        ...(geometrySpec?.objects.flatMap((object) => [object.stableKey, object.displayNameZh]) ?? []),
        ...(selected?.snapshot.entities.map((entity) => entity.name) ?? []),
      ],
      measurements: () => (selected?.snapshot.measurements ?? [])
        .filter((measurement) => measurement.quantity.normalizedUnit === "mm")
        .map((measurement) => ({
          part: measurement.subjectRef,
          valueMm: Number(measurement.quantity.normalizedValue),
          measured: measurement.metadataStatus === "complete",
        })),
      switchStage: (stageId) => {
        if (isStageId(stageId)) nav.goToView(stageId);
      },
      exitProject: () => session.exitToProjectList(),
      advanceStage: () => nav.advanceStage(),
      jobProgressSummary: () => jobs.jobProgressSummary(),
      startGeometryJob: async () => { await jobs.generateDemoGeometry(); },
      startDrawingJob: async () => { await jobs.generateDrawings(); },
      startModelJob: async () => { await jobs.runModel(); },
      exportPackage: async (format) => { await jobs.downloadProject(format === "json" ? "json" : "zip"); },
      runDataCheck: async () => {
        if (!selected) return;
        await assistantExecutors.runDataCheck(selected);
        await loadProject(selected.projectId);
      },
      presentProposal: setPendingProposal,
    }, input);
    // 写入型动作把项目重新读一遍。执行体只写库不碰组件状态，不重读的话
    // 助手回报已新增而构件表纹丝不动，要退出项目再进来才看得到。
    if (outcome.mutated && selected) await loadProject(selected.projectId);
    return outcome;
  };

  const adoptProposal = async () => {
    if (!selected || !pendingProposal) return;
    try {
      await assistantExecutors.commitConfirmedModification(selected, pendingProposal);
      setPendingProposal(null);
      await loadProject(selected.projectId);
      setNotice("修改建议已确认生效");
    } catch (reason) {
      setError(describeFailure(reason, "修改建议生效失败"));
    }
  };

  const rejectProposal = () => {
    setPendingProposal(null);
    setNotice("修改建议已拒绝，未生效");
  };

  // 助手建议由用户明确发起。浏览阶段不应在后台累计模型调用和费用。
  const [suggestion, setSuggestion] = useState<{ text: string; basis: string; loading: boolean; key: string }>({ text: "", basis: "", loading: false, key: "" });
  const suggestionRequest = useRef(0);
  const suggestionKey = selected ? `${selected.projectId}:${selected.revisionId}:${nav.activeStage}` : "";
  const modelReady = session.serverStatus?.modelConfigured === true;
  useEffect(() => {
    suggestionRequest.current += 1;
    setSuggestion({ text: "", basis: "", loading: false, key: suggestionKey });
  }, [suggestionKey]);
  const requestSuggestion = async () => {
    if (!selected || !modelReady || suggestion.loading) return;
    const controller = new AbortController();
    const request = ++suggestionRequest.current;
    setSuggestion({ text: "", basis: "", loading: true, key: suggestionKey });
    try {
      const reply = await assistantChatClient.suggest(buildAssistantSnapshot(), controller.signal);
      if (request === suggestionRequest.current) setSuggestion({ text: reply.source === "model" ? reply.suggestion : "", basis: reply.basis, loading: false, key: suggestionKey });
    } catch {
      if (request === suggestionRequest.current) setSuggestion({ text: "", basis: "", loading: false, key: suggestionKey });
    }
  };

  // 当前状态条（05 表 3）：说明系统正在做什么与进度，不用静态文案顶替
  const currentStatusText = (() => {
    if (!selected) return "选中项目后，可在这里对助手下达操作指令。";
    if (jobs.modelRunning && jobs.modelProgress) return "助手正在识别资料，稍后给出结果";
    if (jobs.cadProgress && !["succeeded", "failed", "cancelled"].includes(jobs.cadProgress.phase)) return "正在生成三维模型";
    const openCount = session.dashboard?.openIssueCount ?? 0;
    if (openCount > 0) return `有 ${openCount} 项等你处理，其余部分照常推进`;
    return `当前在${stageLabel(nav.activeStage)}，没有需要你处理的事项`;
  })();

  const readModelInput = selected ? {
    head: selected,
    modelRuns: session.projectModelRuns,
    ruleRuns: session.projectRuleRuns,
    decisions: session.projectDecisions,
    artifacts: session.projectArtifacts,
    checks: session.projectCheckRuns,
    evaluations: session.projectDeliveryEvaluations,
    deliveries: session.projectDeliveries,
  } : null;
  const provenance = readModelInput ? buildProvenanceGraphView(readModelInput, nav.selectedGeometryEntity) : null;

  // 助手输入区的选区引用：带资料标题，回合随消息一起上送
  const chatSelection = evidence.imageSelection && selected
    ? {
      evidenceId: evidence.imageSelection.evidenceId,
      evidenceTitle: selected.snapshot.evidences.find((item) => item.id === evidence.imageSelection!.evidenceId)?.title ?? "资料原件",
      rectNormalized: evidence.imageSelection.rectNormalized,
    }
    : null;

  return {
    assistantChatClient, pendingProposal, buildAssistantSnapshot, handleAssistantClientOp,
    adoptProposal, rejectProposal, currentStatusText, provenance, chatSelection, suggestion, requestSuggestion,
  };
}

export type AssistantBridge = ReturnType<typeof useAssistantBridge>;
