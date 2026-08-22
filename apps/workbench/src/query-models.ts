import type { ProjectHead } from "@gujian/application";
import { estimateRunCost, formatCost, type ModelRunCost } from "./model-pricing";
import type {
  ArtifactRecord,
  CheckRun,
  Decision,
  DeliveryDraft,
  DeliveryEvaluation,
  ModelRun,
  ProjectGeometryObject,
  RuleRun,
} from "@gujian/domain";

import { QUALIFICATION_CHIP_LABEL } from "./qualification";

export type WorkbenchStage =
  | "资料整理"
  | "问题处理中"
  | "几何待生成"
  | "图纸待生成"
  | "检查与交付";

export interface ProjectDashboardSummary {
  readonly stage: WorkbenchStage;
  readonly evidenceCompleteness: number;
  readonly parsedEvidenceCount: number;
  readonly openIssueCount: number;
  readonly geometryRevisionCount: number;
  readonly artifactCount: number;
  readonly blockerCodes: readonly string[];
  readonly qualificationLabel: typeof QUALIFICATION_CHIP_LABEL;
}

export interface ProvenanceNode {
  readonly key: "evidence" | "fact" | "run" | "decision" | "geometry" | "artifact" | "check" | "delivery";
  readonly label: string;
  readonly count: number;
  readonly status: "available" | "missing" | "blocked";
  readonly refs: readonly string[];
}

export interface ProvenanceGraphView {
  readonly selectedObjectId: string | null;
  readonly nodes: readonly ProvenanceNode[];
  readonly unknownCount: number;
  readonly formalBlockerCount: number;
}

export interface ArtifactSetView {
  readonly geometryRevisionId: string | null;
  readonly currentArtifacts: readonly ArtifactRecord[];
  readonly latestCheckRun: CheckRun | null;
  readonly latestDelivery: DeliveryDraft | null;
  readonly crossRevisionArtifactCount: number;
}

export interface ModelRunCostRow {
  readonly runId: string;
  readonly provider: string;
  readonly model: string;
  readonly status: ModelRun["status"];
  readonly attempts: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly cachedTokens: number | null;
  /** 算得出就是金额，算不出写明为什么算不出 */
  readonly costLabel: string;
  readonly cost: ModelRunCost | null;
}

export interface ModelRunCostView {
  readonly rows: readonly ModelRunCostRow[];
  readonly totalTokens: number;
  readonly hasPriceBasis: boolean;
  /** 有单价的那些运行的费用合计。一条都算不出时为 null */
  readonly totalCost: ModelRunCost | null;
  /** 单价出处，界面上要标出来 */
  readonly priceSourcesZh: readonly string[];
}

export interface HumanInterventionView {
  readonly missingFieldFacts: readonly string[];
  readonly professionalChoices: readonly string[];
  readonly groupedReviewRefs: readonly string[];
  readonly resolvedDecisionCount: number;
}

interface ReadModelInput {
  readonly head: ProjectHead;
  readonly modelRuns: readonly ModelRun[];
  readonly ruleRuns: readonly RuleRun[];
  readonly decisions: readonly Decision[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly checks: readonly CheckRun[];
  readonly evaluations: readonly DeliveryEvaluation[];
  readonly deliveries: readonly DeliveryDraft[];
}

export function buildProjectDashboardSummary(input: ReadModelInput): ProjectDashboardSummary {
  const { snapshot } = input.head;
  const parsed = snapshot.parseRecords.filter((record) => record.status === "parsed").length;
  const evidenceTotal = snapshot.evidences.length;
  const evidenceCompleteness = evidenceTotal === 0 ? 0 : Math.round((parsed / evidenceTotal) * 100);
  const openIssues = snapshot.issues.filter((issue) => issue.status === "open");
  const geometryRevision = snapshot.geometryRevisions.at(-1) ?? null;
  const currentArtifacts = input.artifacts.filter((artifact) => artifact.geometryRevisionId === geometryRevision?.id);
  const latestEvaluation = input.evaluations.at(-1) ?? null;
  const blockers = new Set<string>([
    ...openIssues.filter((issue) => issue.blocksProxyOutcome).map((issue) => issue.issueType),
    ...(geometryRevision?.blockers ?? []),
    ...(latestEvaluation?.blockerCodes ?? []),
  ]);
  const stage: WorkbenchStage = !evidenceTotal
    ? "资料整理"
    : openIssues.length
      ? "问题处理中"
      : !geometryRevision
        ? "几何待生成"
        : !currentArtifacts.length
          ? "图纸待生成"
          : "检查与交付";
  return {
    stage,
    evidenceCompleteness,
    parsedEvidenceCount: parsed,
    openIssueCount: openIssues.length,
    geometryRevisionCount: snapshot.geometryRevisions.length,
    artifactCount: currentArtifacts.length,
    blockerCodes: [...blockers],
    qualificationLabel: QUALIFICATION_CHIP_LABEL,
  };
}

export function buildArtifactSetView(input: ReadModelInput): ArtifactSetView {
  const geometryRevisionId = input.head.snapshot.geometryRevisions.at(-1)?.id ?? null;
  const currentArtifacts = input.artifacts.filter((artifact) => artifact.geometryRevisionId === geometryRevisionId);
  const latestCheckRun = input.checks
    .filter((check) => check.geometryRevisionId === geometryRevisionId)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
    .at(-1) ?? null;
  const latestEvaluationIds = new Set(input.evaluations
    .filter((evaluation) => evaluation.geometryRevisionId === geometryRevisionId)
    .map((evaluation) => evaluation.id));
  const latestDelivery = input.deliveries
    .filter((delivery) => delivery.geometryRevisionId === geometryRevisionId && latestEvaluationIds.has(delivery.evaluationId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1) ?? null;
  return {
    geometryRevisionId,
    currentArtifacts,
    latestCheckRun,
    latestDelivery,
    crossRevisionArtifactCount: input.artifacts.length - currentArtifacts.length,
  };
}

export function buildModelRunCostView(modelRuns: readonly ModelRun[]): ModelRunCostView {
  const rows = [...modelRuns].reverse().map((run) => {
    const cost = estimateRunCost({
      provider: run.provider,
      model: run.model,
      promptTokens: run.usage?.promptTokens ?? null,
      completionTokens: run.usage?.completionTokens ?? null,
      cachedTokens: run.usage?.cachedTokens ?? null,
    });
    return {
      runId: run.id,
      provider: run.provider,
      model: run.model,
      status: run.status,
      attempts: Math.max(...run.events.map((event) => event.attempt), 1),
      promptTokens: run.usage?.promptTokens ?? null,
      completionTokens: run.usage?.completionTokens ?? null,
      totalTokens: run.usage?.totalTokens ?? null,
      cachedTokens: run.usage?.cachedTokens ?? null,
      cost,
      // 算不出的两种情形要分开说：没有这个模型的单价，和这次运行没留下用量
      costLabel: cost
        ? formatCost(cost)
        : run.usage
          ? `无 ${run.model} 的单价`
          : "本次运行未记录用量",
    };
  });
  const priced = rows.map((row) => row.cost).filter((cost): cost is ModelRunCost => cost !== null);
  return {
    rows,
    totalTokens: rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0),
    hasPriceBasis: priced.length > 0,
    totalCost: priced.length
      ? { currency: priced[0]!.currency, amount: priced.reduce((sum, cost) => sum + cost.amount, 0), sourceZh: priced[0]!.sourceZh }
      : null,
    priceSourcesZh: [...new Set(priced.map((cost) => cost.sourceZh))],
  };
}

export function buildHumanInterventionView(input: Pick<ReadModelInput, "head" | "decisions" | "deliveries">): HumanInterventionView {
  const openIssues = input.head.snapshot.issues.filter((issue) => issue.status === "open");
  return {
    missingFieldFacts: openIssues.filter((issue) => issue.issueType === "missingEvidence").map((issue) => issue.id),
    professionalChoices: openIssues.filter((issue) => issue.issueType === "professionalUncertainty").map((issue) => issue.id),
    groupedReviewRefs: input.deliveries.map((delivery) => delivery.id),
    resolvedDecisionCount: input.decisions.length,
  };
}

export function buildProvenanceGraphView(input: ReadModelInput, selectedObject: ProjectGeometryObject | null): ProvenanceGraphView {
  const { snapshot } = input.head;
  const geometryRevision = snapshot.geometryRevisions.at(-1) ?? null;
  const objectFactRefs = selectedObject?.factRefs ?? snapshot.facts.map((fact) => fact.id);
  const objectEvidenceRefs = selectedObject?.evidenceRefs ?? snapshot.evidences.map((evidence) => evidence.id);
  const objectUnknowns = selectedObject
    ? (snapshot.geometrySpecs.at(-1)?.unknowns ?? []).filter((unknown) => selectedObject.unknownRefs.includes(unknown.id))
    : (snapshot.geometrySpecs.at(-1)?.unknowns ?? []);
  const openIssues = snapshot.issues.filter((issue) => issue.status === "open");
  const currentArtifacts = input.artifacts.filter((artifact) => artifact.geometryRevisionId === geometryRevision?.id);
  const currentChecks = input.checks.filter((check) => check.geometryRevisionId === geometryRevision?.id);
  const currentDeliveries = input.deliveries.filter((delivery) => delivery.geometryRevisionId === geometryRevision?.id);
  const node = (key: ProvenanceNode["key"], label: string, refs: readonly string[], blocked = false): ProvenanceNode => ({
    key,
    label,
    count: refs.length,
    status: blocked ? "blocked" : refs.length ? "available" : "missing",
    refs,
  });
  return {
    selectedObjectId: selectedObject?.id ?? null,
    nodes: [
      node("evidence", "原始资料", objectEvidenceRefs),
      node("fact", "尺寸与事实", objectFactRefs),
      node("run", "识别与自动核对", [...input.modelRuns.map((run) => run.id), ...input.ruleRuns.map((run) => run.id)]),
      node("decision", "人工决定", input.decisions.map((decision) => decision.id)),
      node("geometry", "三维模型", geometryRevision ? [geometryRevision.id] : [], objectUnknowns.some((item) => item.blocksProxyOutcome)),
      node("artifact", "图纸与成果", currentArtifacts.map((artifact) => artifact.id)),
      node("check", "检查记录", currentChecks.map((check) => check.id), currentChecks.some((check) => check.results.some((result) => result.outcome === "blocked"))),
      node("delivery", "交付草案", currentDeliveries.map((delivery) => delivery.id)),
    ],
    // 待确认与影响正式交付两个计数要把问题队列算进来。
    // 只算三维模型里的未确认项会在没生成模型时显示成零，
    // 与同屏的待办条数矛盾，看上去像没有任何阻断。
    unknownCount: objectUnknowns.length + openIssues.length,
    formalBlockerCount: objectUnknowns.filter((unknown) => unknown.blocksFormalEligibility).length
      + openIssues.filter((issue) => issue.blocksFormalEligibility).length,
  };
}
