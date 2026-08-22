import { useMemo, useState } from "react";

import type { ModificationProposal } from "../assistant/action-executors";
import { AssistantClient } from "../assistant/assistant-client";
import { runClientOp } from "../assistant/client-op-adapter";
import { buildWorkspaceSnapshot } from "../assistant/workspace-snapshot";
import { describeFailure } from "../failure-notice";
import { buildProvenanceGraphView } from "../query-models";
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

  const buildAssistantSnapshot = () => buildWorkspaceSnapshot({
    projectId: selected?.projectId ?? null,
    currentStage: nav.activeStage,
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
    adoptProposal, rejectProposal, currentStatusText, provenance, chatSelection,
  };
}

export type AssistantBridge = ReturnType<typeof useAssistantBridge>;
