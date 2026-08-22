import { useEffect, useMemo, useState } from "react";
import type { ProjectHead, ProjectSummary } from "@gujian/application";
import type {
  ArchetypeSpec, ArtifactRecord, CheckRun, Decision, DeliveryDraft, DeliveryEvaluation, ModelRun, RuleRun,
} from "@gujian/domain";
import {
  compareWithMeasuredFacts, conceptLabel, deriveArchetypeExpectations, geometryPrerequisites, resolveVocabulary,
} from "@gujian/infrastructure";

import { buildChangeHistory, type ChangeHistoryEntry } from "../change-history";
import type { DemoLoadResult } from "../demo-library-loader";
import { describeFailure } from "../failure-notice";
import { describeBlocker } from "../qualification";
import {
  buildArtifactSetView, buildHumanInterventionView, buildModelRunCostView, buildProjectDashboardSummary,
} from "../query-models";
import {
  createLocalProject, deliveries, listLocalProjects, localActorId, projectPackages, projectRepository, workflow,
} from "../workbench";
import type { Notices } from "./useNotices";

export interface ServerStatus {
  ready: boolean;
  model: string;
  modelConfigured: boolean;
}

export interface CreateProjectValues {
  name: string;
  buildingName: string;
  locationText: string;
}

interface SessionDeps {
  bootstrapDemo: () => Promise<DemoLoadResult | null>;
  notices: Notices;
}

// 项目会话：当前项目的头、副表与派生数据。所有写入后的重读都经 loadProject，
// 组件不直接碰仓库。
export function useProjectSession({ bootstrapDemo, notices }: SessionDeps) {
  const { setError, setNotice } = notices;
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [selected, setSelected] = useState<ProjectHead | null>(null);
  const [projectModelRuns, setProjectModelRuns] = useState<readonly ModelRun[]>([]);
  const [projectRuleRuns, setProjectRuleRuns] = useState<readonly RuleRun[]>([]);
  const [projectDecisions, setProjectDecisions] = useState<readonly Decision[]>([]);
  const [projectArtifacts, setProjectArtifacts] = useState<readonly ArtifactRecord[]>([]);
  const [projectCheckRuns, setProjectCheckRuns] = useState<readonly CheckRun[]>([]);
  const [projectDeliveryEvaluations, setProjectDeliveryEvaluations] = useState<readonly DeliveryEvaluation[]>([]);
  const [projectDeliveries, setProjectDeliveries] = useState<readonly DeliveryDraft[]>([]);
  const [projectArchetypes, setProjectArchetypes] = useState<readonly ArchetypeSpec[]>([]);
  const [changeHistory, setChangeHistory] = useState<readonly ChangeHistoryEntry[]>([]);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [query, setQuery] = useState("");
  const vocabulary = useMemo(() => resolveVocabulary(), []);

  const refresh = async () => setProjects(await listLocalProjects());

  const loadProject = async (projectId: string) => {
    setError(null);
    const head = await projectRepository.getProjectHead(projectId);
    const [runs, rules, decisions, artifacts, matrices, checks, deliveryEvaluations, deliveryRecords] = await Promise.all([
      projectRepository.getProjectModelRuns(projectId),
      projectRepository.getProjectRuleRuns(projectId),
      projectRepository.getProjectDecisions(projectId),
      projectRepository.getProjectArtifacts(projectId),
      // 出图要求是任务要求到图纸这一段的中间环节，算影响范围要用
      projectRepository.getProjectArtifactRequirementMatrices(projectId),
      projectRepository.getProjectCheckRuns(projectId),
      projectRepository.getProjectDeliveryEvaluations(projectId),
      projectRepository.getProjectDeliveries(projectId),
    ]);
    setSelected(head);
    setProjectModelRuns(runs);
    setProjectRuleRuns(rules);
    setProjectDecisions(decisions);
    setProjectArtifacts(artifacts);
    setProjectCheckRuns(checks);
    setProjectDeliveryEvaluations(deliveryEvaluations);
    setProjectDeliveries(deliveryRecords);
    setProjectArchetypes(await projectRepository.getProjectArchetypeSpecs(projectId));
    // 修改历史每次读项目时一并算好。审计事件与回执是只增的，量随操作数增长，
    // 不随快照大小增长，因此不做分页。
    const [auditEvents, receipts] = await Promise.all([
      projectRepository.getProjectAuditEvents(projectId),
      projectRepository.getProjectCommandReceipts(projectId),
    ]);
    setChangeHistory(buildChangeHistory({
      auditEvents,
      receipts,
      snapshot: head?.snapshot ?? null,
      impactInput: head ? {
        snapshot: head.snapshot,
        artifacts,
        requirementMatrices: matrices,
        checkRuns: checks,
        deliveryEvaluations,
        deliveries: deliveryRecords,
      } : null,
    }));
  };

  // 首次打开装载演示项目（08 演示项目定义 3.3：不生成空白项目）。
  // 装载策略由组合根注入，组件只负责把结果显示出来。
  const showBootstrapResult = async (result: DemoLoadResult | null) => {
    if (!result) return;
    if (result.loaded.length) {
      await refresh();
      setNotice(`已载入 ${result.loaded.length} 个演示项目。演示数据标为示例来源，不能作为真实成果。`);
    }
    if (result.failed.length) setError(describeFailure(result.failed[0]!.reason, "演示项目载入失败"));
  };

  useEffect(() => {
    void refresh()
      .then(bootstrapDemo)
      .then(showBootstrapResult)
      .catch((reason: unknown) => setError(describeFailure(reason, "载入项目列表失败")));
    void fetch("/api/status")
      .then(async (response) => response.ok ? response.json() as Promise<ServerStatus> : Promise.reject(new Error("SERVER_STATUS_FAILED")))
      .then(setServerStatus)
      .catch(() => setServerStatus(null));
  }, []);

  const chooseProject = async (projectId: string) => {
    setError(null);
    await loadProject(projectId);
  };

  // 退出当前项目回到列表页。左栏按钮与助手走同一处，行为不分叉。
  const exitToProjectList = () => setSelected(null);

  const createProject = async (values: CreateProjectValues): Promise<ProjectHead | null> => {
    setError(null);
    try {
      const head = await createLocalProject(values);
      await refresh();
      const evaluated = await workflow.evaluate(head, localActorId());
      setSelected(evaluated);
      setProjectModelRuns([]);
      setProjectRuleRuns(await projectRepository.getProjectRuleRuns(head.projectId));
      setProjectDecisions([]);
      setProjectArtifacts([]); setProjectCheckRuns([]); setProjectDeliveryEvaluations([]); setProjectDeliveries([]);
      return evaluated;
    } catch (reason) {
      setError(describeFailure(reason, "项目创建失败"));
      return null;
    }
  };

  const importProject = async (file: File): Promise<boolean> => {
    setError(null);
    try {
      const projectId = await projectPackages.import(new Uint8Array(await file.arrayBuffer()), file.name, localActorId());
      await refresh();
      await loadProject(projectId);
      setNotice("项目包已校验并导入本地库");
      return true;
    } catch (reason) {
      setError(describeFailure(reason, "项目包导入失败"));
      return false;
    }
  };

  const clearLibrary = async () => {
    if (!window.confirm("清空本地项目库？请先导出需要保留的项目包。")) return;
    await projectRepository.clearAllData();
    setSelected(null);
    setProjectModelRuns([]);
    setProjectRuleRuns([]);
    setProjectDecisions([]);
    setProjectArtifacts([]); setProjectCheckRuns([]); setProjectDeliveries([]);
    await refresh();
    setNotice("本机项目已清空");
  };

  const filtered = useMemo(
    () => projects.filter((project) => `${project.name}${project.buildingName}`.toLowerCase().includes(query.toLowerCase())),
    [projects, query],
  );

  // 以下派生数据每次渲染重算。快照在内存里，算的都是过滤与查找，不值得缓存。
  const snapshot = selected?.snapshot ?? null;
  const parsedEvidenceCount = snapshot?.parseRecords.filter((record) => record.status === "parsed" && record.extractedText?.trim()).length ?? 0;
  // 可读图的资料：图纸类且文件在本机。是不是图像格式由运行侧按资料本体判定，
  // 界面不重复一份格式清单。
  const readableDrawingEvidenceIds = snapshot?.evidences
    .filter((item) => item.evidenceType === "drawing" && item.dataStatus === "available")
    .map((item) => item.id) ?? [];
  const confirmedTask = snapshot?.taskDefinitions.find((task) => task.confirmedAt !== null) ?? null;
  const openIssues = snapshot?.issues.filter((issue) => issue.status === "open") ?? [];
  const geometryRevision = snapshot?.geometryRevisions.at(-1) ?? null;
  // 已有版本时取其绑定的 spec；否则取项目包导入的最新 spec（existingGeometrySpec 首次生成路径）
  const geometrySpec = snapshot
    ? (geometryRevision
      ? snapshot.geometrySpecs.find((item) => item.id === geometryRevision.geometrySpecId) ?? null
      : snapshot.geometrySpecs.at(-1) ?? null)
    : null;
  const latestCheckRun = projectCheckRuns
    .filter((item) => item.geometryRevisionId === geometryRevision?.id)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
    .at(-1) ?? null;
  const latestCheckedArtifactIds = new Set(latestCheckRun?.artifactRefs ?? []);
  const drawingArtifacts = projectArtifacts.filter((item) => item.geometryRevisionId === geometryRevision?.id && latestCheckedArtifactIds.has(item.id));
  const latestDeliveryEvaluationIds = new Set(projectDeliveryEvaluations
    .filter((item) => item.geometryRevisionId === geometryRevision?.id && latestCheckRun && item.checkRunRefs.includes(latestCheckRun.id))
    .map((item) => item.id));
  const latestDelivery = projectDeliveries
    .filter((item) => item.geometryRevisionId === geometryRevision?.id && latestDeliveryEvaluationIds.has(item.evaluationId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1) ?? null;
  const latestBlockedDelivery = projectDeliveryEvaluations
    .filter((item) => item.outcome === "blocked")
    .sort((left, right) => left.evaluatedAt.localeCompare(right.evaluatedAt))
    .at(-1) ?? null;
  // 项目自带 GeometrySpec 时走 existingGeometrySpec 重绑路径，不要求逐构件事实
  const geometryGate = selected
    ? (selected.snapshot.geometrySpecs.length ? { ready: true, missing: [] as string[] } : geometryPrerequisites(selected))
    : null;
  const readModelInput = selected ? {
    head: selected,
    modelRuns: projectModelRuns,
    ruleRuns: projectRuleRuns,
    decisions: projectDecisions,
    artifacts: projectArtifacts,
    checks: projectCheckRuns,
    evaluations: projectDeliveryEvaluations,
    deliveries: projectDeliveries,
  } : null;
  const dashboard = readModelInput ? buildProjectDashboardSummary(readModelInput) : null;
  const artifactSetView = readModelInput ? buildArtifactSetView(readModelInput) : null;
  const modelCostView = buildModelRunCostView(projectModelRuns);
  const humanInterventions = readModelInput ? buildHumanInterventionView(readModelInput) : null;
  // 交付阻断在渲染里反复调服务是旧写法，这里算一次给页面用
  const deliveryBlockers = selected ? deliveries.blockers(selected) : [];

  // 应然与实测超容差的差异即现状记录候选（架构 v1.4 §5.7）
  const archetypeDifferences = (() => {
    const archetype = projectArchetypes.at(-1);
    if (!archetype || !snapshot) return [];
    return compareWithMeasuredFacts(deriveArchetypeExpectations(archetype), snapshot.facts)
      .filter((item) => item.withinTolerance === false);
  })();

  const typeLabel = (componentType: string, conceptRef?: string) =>
    conceptLabel(vocabulary, conceptRef ?? componentType) ?? componentType;

  // 引用一律显示资料名称，不显示内部编号。
  // 找不到对应资料时如实说明，不能用泛称掩盖引用失效。
  const evidenceTitle = (ref: string) => {
    const evidence = snapshot?.evidences.find((item) => item.id === ref || ref.endsWith(item.id));
    return evidence?.title ?? "引用的资料缺失";
  };

  // 字段名转成测绘人员熟悉的说法
  const factFieldLabel = (field: string) => {
    const named: Record<string, string> = {
      "documentedDimension.totalWidthMm": "资料记载总尺寸",
      "documentedDimension.segmentWidthsMm": "资料记载分段尺寸",
      "documentedDimension.measurementMetadataComplete": "测量记录完整性",
      "roofFrame.totalDepthMm": "通进深",
      "roofFrame.stepCount": "步架数",
    };
    if (named[field]) return named[field];
    const measured = field.match(/^archetype\.measured\.(.+)$/);
    if (measured) return `${measured[1]}（实测）`;
    return field;
  };

  // 数据来源构成（07 界面视觉规范表 3）：四类来源按数据模型的 producerType 统计。
  // 数据模型没有"实测"这一类来源，实测另按测量记录统计，不能拿人工确认顶替。
  const basisCounts = (() => {
    const counts = { model: 0, human: 0, rule: 0, demo: 0 };
    const add = (producerType: string) => {
      const type = producerType as keyof typeof counts;
      if (type in counts) counts[type] += 1;
    };
    for (const fact of snapshot?.facts ?? []) add(fact.producer.producerType);
    // 构件也是数据，它的来源要计入。只统计事实会让纯几何项目
    // 五类来源全显示为零，看上去像没有任何来源信息。
    for (const object of geometrySpec?.objects ?? []) add(object.producer.producerType);
    return counts;
  })();

  // 实测记录：只算测量人、时间、方法齐全的记录，这是系统内唯一有现场实测支撑的口径
  const measuredRecordCount = (snapshot?.measurements ?? [])
    .filter((item) => item.metadataStatus === "complete").length;

  // 阻断原因用中文说法显示。多个内部码可能翻成同一句话，去重后再列。
  const blockerReasons = [...new Set((dashboard?.blockerCodes ?? []).map(describeBlocker))];

  return {
    projects, filtered, query, setQuery,
    selected, setSelected,
    projectModelRuns, setProjectModelRuns,
    projectRuleRuns, setProjectRuleRuns,
    projectDecisions, setProjectDecisions,
    projectArtifacts, projectCheckRuns, projectDeliveryEvaluations, projectDeliveries,
    projectArchetypes, changeHistory, serverStatus,
    refresh, loadProject, chooseProject, exitToProjectList, createProject, importProject, clearLibrary,
    parsedEvidenceCount, readableDrawingEvidenceIds, confirmedTask, openIssues,
    geometryRevision, geometrySpec, latestCheckRun, drawingArtifacts, latestDelivery, latestBlockedDelivery,
    geometryGate, dashboard, artifactSetView, modelCostView, humanInterventions, deliveryBlockers,
    archetypeDifferences, typeLabel, evidenceTitle, factFieldLabel, basisCounts, measuredRecordCount, blockerReasons,
  };
}

export type ProjectSession = ReturnType<typeof useProjectSession>;
