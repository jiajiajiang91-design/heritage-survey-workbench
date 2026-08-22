import type {
  ArtifactRecord,
  ArtifactRequirementMatrix,
  CheckRun,
  DeliveryDraft,
  DeliveryEvaluation,
  ProjectSnapshot,
} from "@gujian/domain";

// 影响范围（技术架构 5.4）。数据改了之后，程序算出哪些下游内容因此失效。
//
// 依赖图按推导得出，不另存一份。记录里的 geometryRevisionId 一类字段是权威的，
// 另存一份边只是它的副本，两者一旦不同步，算出来的影响范围就是错的且看不出来。
// 快照里的 dependencyEdges 字段因此恒为空，由测试锁住。
//
// 引用按原字符串比对，不做归一。三个演示包查过：记录 id 之间没有格式差异，
// 带前缀的字符串都不是记录 id，各有各的含义：
//   archetype:<ruleSetId>:<key>   形制参数引用，几何来自形制推算而非项目事实
//   demo:v3-entity:<uuid>         v3 转换时保留的原始构件 id，包里没有对应记录
//   purlin:0、wall:back           几何对象的 stableKey，不是记录 id

/** 算影响要的全部记录。成果、检查、交付不在快照里，得单独给。 */
export interface ImpactGraphInput {
  readonly snapshot: ProjectSnapshot;
  readonly artifacts: readonly ArtifactRecord[];
  readonly requirementMatrices: readonly ArtifactRequirementMatrix[];
  readonly checkRuns: readonly CheckRun[];
  readonly deliveryEvaluations: readonly DeliveryEvaluation[];
  readonly deliveries: readonly DeliveryDraft[];
}

export type ImpactRecordKind =
  | "资料" | "事实" | "现状" | "实测" | "关系" | "构件"
  | "几何规格" | "几何版本" | "出图要求" | "成果" | "检查" | "交付评估" | "交付草案";

export interface ImpactGroup {
  readonly kind: ImpactRecordKind;
  readonly count: number;
  /** 可读名称。取不到名字的用引用原文，不用编的名字冒充 */
  readonly names: readonly string[];
}

export interface ImpactResult {
  /** 失效的下游，按记录类型分组 */
  readonly groups: readonly ImpactGroup[];
  /** 失效总条数，不含 preserved */
  readonly total: number;
  /** 已交付或已签发，列出但不算失效（架构 5.4：已交付版本始终保留） */
  readonly preserved: readonly ImpactGroup[];
  /** 图里指向不存在记录的引用条数。丢弃会让影响范围显得比实际小 */
  readonly unresolvedRefCount: number;
  /** 名称清单被截断掉的条数。截断不能静默 */
  readonly truncatedNameCount: number;
  /** 已知算不全的链路。非空时界面要提示这次算的不全 */
  readonly coverageGaps: readonly string[];
}

/** 每组最多列几个名字。超出只给条数，截断数记在 truncatedNameCount */
const NAME_LIMIT = 20;

interface RecordIndex {
  readonly kind: ImpactRecordKind;
  readonly name: string;
  readonly preserved: boolean;
}

/** 有向图：上游引用 → 下游引用集合。只存下游方向，从源头上杜绝走反 */
export interface DependencyGraph {
  readonly downstream: ReadonlyMap<string, ReadonlySet<string>>;
  readonly index: ReadonlyMap<string, RecordIndex>;
  readonly unresolvedRefCount: number;
  readonly archetypeRefCount: number;
}

function add(map: Map<string, Set<string>>, from: string, to: string): void {
  if (!from || !to || from === to) return;
  const set = map.get(from);
  if (set) set.add(to);
  else map.set(from, new Set([to]));
}

function buildIndex(input: ImpactGraphInput): Map<string, RecordIndex> {
  const { snapshot } = input;
  const index = new Map<string, RecordIndex>();
  const put = (id: string, kind: ImpactRecordKind, name: string, preserved = false) => {
    index.set(id, { kind, name, preserved });
  };
  for (const item of snapshot.evidences) put(item.id, "资料", item.title);
  for (const item of snapshot.facts) put(item.id, "事实", item.field);
  for (const item of snapshot.observations) put(item.id, "现状", item.text.slice(0, 40));
  for (const item of snapshot.measurements) put(item.id, "实测", item.subjectRef);
  for (const item of snapshot.relations) put(item.id, "关系", item.relationType);
  for (const item of snapshot.entities) put(item.id, "构件", item.name);
  for (const item of snapshot.geometrySpecs) put(item.id, "几何规格", `几何规格 ${item.objects.length} 个对象`);
  for (const item of snapshot.geometryRevisions) put(item.id, "几何版本", `几何版本 ${item.id.slice(0, 8)}`);
  for (const item of input.requirementMatrices) put(item.id, "出图要求", item.titleZh);
  for (const item of input.artifacts) put(item.id, "成果", item.fileName);
  for (const item of input.checkRuns) put(item.id, "检查", `检查 ${item.results.length} 项`);
  for (const item of input.deliveryEvaluations) put(item.id, "交付评估", `交付评估 ${item.outcome}`);
  // 交付草案：已签发或已交付的保留不失效。当前产品只有代理未签发一种状态，
  // 按字段判断而不是写死，正式签发能力具备后这里不必再改。
  for (const item of input.deliveries) {
    const preserved = item.signatureStatus !== "unsigned" || item.status !== "proxy-unissued";
    put(item.id, "交付草案", `交付草案 ${item.restrictions.length} 项限制`, preserved);
  }
  return index;
}

// 七类边逐类一个函数，函数名与 DependencyEdgeSchema 的 dependencyType 同名，
// 便于与规格第 5.2 节的表逐行对照。每个函数只往 edges 里加边，不做别的。

/** 资料 → 事实、现状、实测、关系 */
export function evidenceToFact(input: ImpactGraphInput, edges: Map<string, Set<string>>): void {
  const { snapshot } = input;
  for (const fact of snapshot.facts) for (const ref of fact.evidenceRefs) add(edges, ref, fact.id);
  for (const observation of snapshot.observations) for (const ref of observation.evidenceRefs) add(edges, ref, observation.id);
  for (const measurement of snapshot.measurements) add(edges, measurement.originalEvidenceRef, measurement.id);
  for (const relation of snapshot.relations) for (const ref of relation.evidenceRefs) add(edges, ref, relation.id);
}

/**
 * 事实与资料 → 几何规格。
 * factRefs 存两种东西：真实事实 id，或 archetype:<ruleSetId>:<key> 形制参数引用。
 * 后者不是项目记录，不建边。三个演示包里 dai-loy 是前者，高都与 t0b 是后者。
 */
export function factToConstraint(
  input: ImpactGraphInput,
  edges: Map<string, Set<string>>,
  index: ReadonlyMap<string, RecordIndex>,
): { unresolved: number; archetype: number } {
  let unresolved = 0;
  let archetype = 0;
  for (const spec of input.snapshot.geometrySpecs) {
    for (const object of spec.objects) {
      for (const ref of [...object.factRefs, ...object.evidenceRefs]) {
        if (ref.startsWith("archetype:")) { archetype += 1; continue; }
        if (index.has(ref)) add(edges, ref, spec.id);
        else unresolved += 1;
      }
    }
  }
  return { unresolved, archetype };
}

/** 几何规格 → 几何版本 */
export function constraintToGeometry(input: ImpactGraphInput, edges: Map<string, Set<string>>): void {
  for (const revision of input.snapshot.geometryRevisions) add(edges, revision.geometrySpecId, revision.id);
}

/** 几何版本 → 成果 */
export function geometryToView(input: ImpactGraphInput, edges: Map<string, Set<string>>): void {
  for (const artifact of input.artifacts) add(edges, artifact.geometryRevisionId, artifact.id);
}

/** 出图依据与任务要求 → 成果。出图要求本身挂在几何版本下面 */
export function viewToArtifact(
  input: ImpactGraphInput,
  edges: Map<string, Set<string>>,
  index: ReadonlyMap<string, RecordIndex>,
): number {
  let unresolved = 0;
  for (const matrix of input.requirementMatrices) add(edges, matrix.geometryRevisionId, matrix.id);
  for (const artifact of input.artifacts) {
    if (artifact.requirementMatrixId) add(edges, artifact.requirementMatrixId, artifact.id);
    for (const ref of artifact.sourceRefs) {
      if (index.has(ref)) add(edges, ref, artifact.id);
      else unresolved += 1;
    }
  }
  return unresolved;
}

/** 成果与几何版本 → 检查 */
export function artifactToCheck(input: ImpactGraphInput, edges: Map<string, Set<string>>): void {
  for (const run of input.checkRuns) {
    add(edges, run.geometryRevisionId, run.id);
    for (const ref of run.artifactRefs) add(edges, ref, run.id);
  }
}

/** 检查与成果 → 交付评估与草案 */
export function checkToDelivery(input: ImpactGraphInput, edges: Map<string, Set<string>>): void {
  for (const evaluation of input.deliveryEvaluations) {
    if (evaluation.geometryRevisionId) add(edges, evaluation.geometryRevisionId, evaluation.id);
    for (const ref of [...evaluation.artifactRefs, ...evaluation.checkRunRefs]) add(edges, ref, evaluation.id);
  }
  for (const draft of input.deliveries) {
    add(edges, draft.evaluationId, draft.id);
    for (const ref of draft.artifactRefs) add(edges, ref, draft.id);
  }
}

export function buildDependencyGraph(input: ImpactGraphInput): DependencyGraph {
  const index = buildIndex(input);
  const edges = new Map<string, Set<string>>();
  evidenceToFact(input, edges);
  const constraint = factToConstraint(input, edges, index);
  constraintToGeometry(input, edges);
  geometryToView(input, edges);
  const viewUnresolved = viewToArtifact(input, edges, index);
  artifactToCheck(input, edges);
  checkToDelivery(input, edges);
  return {
    downstream: edges,
    index,
    unresolvedRefCount: constraint.unresolved + viewUnresolved,
    archetypeRefCount: constraint.archetype,
  };
}

/**
 * 从变更引用出发的下游闭包。只走下游边，图里没存上游方向，走不回去。
 * 已访问集合同时起防环作用：数据里出现环时不会死循环，多余的边直接跳过。
 */
export function computeImpact(input: ImpactGraphInput, changedRefs: readonly string[]): ImpactResult {
  const changedTaskDefinition = input.snapshot.taskDefinitions.some((task) => changedRefs.includes(task.id));
  const graph = buildDependencyGraph(input);
  const start = new Set(changedRefs);
  const reached = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of graph.downstream.get(current) ?? []) {
      // 起点自己不算受影响：它是被改的那个，不是因此失效的
      if (reached.has(next) || start.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }

  const failing = new Map<ImpactRecordKind, string[]>();
  const preserving = new Map<ImpactRecordKind, string[]>();
  for (const ref of reached) {
    const record = graph.index.get(ref);
    if (!record) continue;
    const bucket = record.preserved ? preserving : failing;
    const list = bucket.get(record.kind);
    if (list) list.push(record.name);
    else bucket.set(record.kind, [record.name]);
  }

  let truncated = 0;
  const toGroups = (source: Map<ImpactRecordKind, string[]>): ImpactGroup[] =>
    [...source.entries()].map(([kind, names]) => {
      if (names.length > NAME_LIMIT) truncated += names.length - NAME_LIMIT;
      return { kind, count: names.length, names: names.slice(0, NAME_LIMIT) };
    });

  const groups = toGroups(failing);
  const preserved = toGroups(preserving);

  // 几何的上游留痕有两种断法，都会让从上游出发的影响范围偏小。
  // 一是形制推算：几何对象引用合成字符串 archetype:<ruleSetId>:<key>，
  // 不是产出该参数的 ArchetypeSpec 记录 id，而 ArchetypeSpec 也不在快照里。
  // 二是引用指向包外：转换来的项目保留了原始 id，包里没有对应记录。
  //
  // 两处只在这次查询确实会被它们影响时才报，即起点里有几何上游那几类记录。
  // 起点是成果或交付时报出来只是噪声：那条断链在它们下游之外，与本次无关。
  const upstreamOfGeometry: readonly ImpactRecordKind[] = ["资料", "事实", "构件", "实测", "现状", "关系"];
  const startsUpstream = [...start].some((ref) => {
    const kind = graph.index.get(ref)?.kind;
    return kind !== undefined && upstreamOfGeometry.includes(kind);
  });

  const coverageGaps: string[] = [];
  if (startsUpstream && graph.archetypeRefCount > 0) {
    coverageGaps.push(`形制推算链未留痕，几何有 ${graph.archetypeRefCount} 处引用形制参数而非项目记录，这一段算不出来`);
  }
  if (startsUpstream && graph.unresolvedRefCount > 0) {
    coverageGaps.push(`有 ${graph.unresolvedRefCount} 处引用在本项目里找不到对应记录，这一段上游关系算不出来`);
  }
  // 出图要求记录只指回几何版本，不指回产生它的任务书，任务书那一侧也不存出图要求的 id。
  // 因此改任务要求算不出受影响的图纸，而这正是 F01 要的。数据模型缺一个引用。
  if (changedTaskDefinition && input.requirementMatrices.length > 0) {
    coverageGaps.push("任务书与出图要求之间没有记录相互引用，改任务要求算不出受影响的图纸");
  }

  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.count, 0),
    preserved,
    unresolvedRefCount: graph.unresolvedRefCount,
    truncatedNameCount: truncated,
    coverageGaps,
  };
}

/** 动作层用的入口。与修改历史同一个返回结构，不另定一套。 */
export function previewImpact(input: ImpactGraphInput, changedRefs: readonly string[]): ImpactResult {
  return computeImpact(input, changedRefs);
}
