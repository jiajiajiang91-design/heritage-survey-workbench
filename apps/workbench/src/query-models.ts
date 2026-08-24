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
  ReviewSignoff,
  RuleRun,
} from "@gujian/domain";

import { QUALIFICATION_CHIP_LABEL, SIGNED_CHIP_LABEL } from "./qualification";

export type WorkbenchStage =
  | "资料整理"
  | "问题处理中"
  | "模型待生成"
  | "图纸待生成"
  | "检查与交付"
  | "已签发归档";

export interface ProjectDashboardSummary {
  readonly stage: WorkbenchStage;
  readonly evidenceCompleteness: number;
  readonly parsedEvidenceCount: number;
  readonly openIssueCount: number;
  readonly geometryRevisionCount: number;
  readonly artifactCount: number;
  readonly blockerCodes: readonly string[];
  readonly qualificationLabel: string;
  // 正式环境的复核签发记录（实施单元 09）；没有时为 null，成果按待签发显示
  readonly signoff: ReviewSignoff | null;
}

// 签发解除哪些不通过项：未经复核与本机不能签发两条随签发解除，只阻断正式资格的项视为已复核接受。
// 样板等级（L1）只关系到成果能不能当参照样板，不关系到能不能交付——已签发的成果一律可交付，
// 等级由成果等级一栏单独说明。评估记录是签发前写的，不改；显示时按这里过滤。
const FORMAL_ONLY = new Set(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", "L1_ELIGIBILITY_FALSE", "PROXY_ONLY"]);
export function effectiveBlockerCodes(codes: readonly string[], signoff: ReviewSignoff | null, details?: readonly { code: string; blocksProxyOutcome: boolean }[]): string[] {
  if (!signoff) return [...codes];
  const hard = new Set((details ?? []).filter((item) => item.blocksProxyOutcome).map((item) => item.code));
  return codes.filter((code) => {
    const bare = code.replace(/^CHECK_BLOCKED:/, "");
    if (FORMAL_ONLY.has(bare)) return false;
    if (details?.length) return hard.has(code);
    // 没有明细的来源（几何版本自带的阻断码）按只阻断正式资格处理
    return false;
  });
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
  const signoff = geometryRevision ? snapshot.reviewSignoffs.find((item) => item.geometryRevisionId === geometryRevision.id) ?? null : null;
  const blockers = new Set<string>([
    ...openIssues.filter((issue) => issue.blocksProxyOutcome).map((issue) => issue.issueType),
    ...effectiveBlockerCodes(geometryRevision?.blockers ?? [], signoff),
    ...effectiveBlockerCodes(latestEvaluation?.blockerCodes ?? [], signoff, latestEvaluation?.blockerDetails),
  ]);
  const stage: WorkbenchStage = !evidenceTotal
    ? "资料整理"
    : openIssues.length
      ? "问题处理中"
      : !geometryRevision
        ? "模型待生成"
        : !currentArtifacts.length
          ? "图纸待生成"
          : signoff
            ? "已签发归档"
            : "检查与交付";
  return {
    stage,
    evidenceCompleteness,
    parsedEvidenceCount: parsed,
    openIssueCount: openIssues.length,
    geometryRevisionCount: snapshot.geometryRevisions.length,
    artifactCount: currentArtifacts.length,
    blockerCodes: [...blockers],
    qualificationLabel: signoff ? (signoff.l1Eligible ? SIGNED_CHIP_LABEL : `${SIGNED_CHIP_LABEL} · 不作为样板`) : QUALIFICATION_CHIP_LABEL,
    signoff,
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
      node("fact", "尺寸与记录", objectFactRefs),
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
