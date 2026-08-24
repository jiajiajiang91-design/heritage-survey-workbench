import { describe, expect, it } from "vitest";

import {
  artifactToCheck,
  buildDependencyGraph,
  checkToDelivery,
  computeImpact,
  constraintToGeometry,
  evidenceToFact,
  factToConstraint,
  geometryToView,
  previewImpact,
  viewToArtifact,
  type ImpactGraphInput,
} from "./impact-service.js";

// 七类边逐类一个用例，与规格第 5.2 节的表逐行对照。
// 每个用例只放这一类边需要的记录，断言边的两端，不看整体。

const NOW = "2026-08-22T00:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function emptyInput(): ImpactGraphInput {
  return {
    snapshot: {
      schemaVersion: "3.0",
      project: { id: uuid(1), name: "测试项目", locationText: null, status: "active", createdAt: NOW, updatedAt: NOW },
      buildings: [{ id: uuid(2), projectId: uuid(1), name: "主殿", locationText: null }],
      taskDefinitions: [], evidences: [], parseRecords: [], entities: [], exclusionRecords: [],
      relations: [], observations: [], measurements: [], facts: [], candidates: [], issues: [],
      dependencyEdges: [], geometrySpecs: [], geometryRevisions: [], reviewSignoffs: [], adoptedRecordRefs: [],
    } as unknown as ImpactGraphInput["snapshot"],
    artifacts: [], requirementMatrices: [], checkRuns: [], deliveryEvaluations: [], deliveries: [],
  };
}

function withSnapshot(patch: Record<string, unknown>): ImpactGraphInput {
  const base = emptyInput();
  return { ...base, snapshot: { ...base.snapshot, ...patch } as ImpactGraphInput["snapshot"] };
}

const evidence = (id: string) => ({ id, title: `资料 ${id.slice(-2)}` });
const fact = (id: string, evidenceRefs: string[]) => ({ id, field: "bayCount", evidenceRefs });
const geometryObject = (factRefs: string[], evidenceRefs: string[]) => ({
  id: uuid(90), stableKey: "col:0", factRefs, evidenceRefs,
});
const spec = (id: string, objects: unknown[]) => ({ id, objects });
const artifact = (id: string, geometryRevisionId: string, sourceRefs: string[] = [], requirementMatrixId: string | null = null) => ({
  id, geometryRevisionId, sourceRefs, requirementMatrixId, fileName: `${id.slice(-2)}.svg`,
});

describe("七类边逐类推导（规格第 5.2 节）", () => {
  it("evidenceToFact：资料到事实、现状、实测、关系", () => {
    const input = withSnapshot({
      evidences: [evidence(uuid(10))],
      facts: [fact(uuid(20), [uuid(10)])],
      observations: [{ id: uuid(21), text: "柱脚糟朽", evidenceRefs: [uuid(10)] }],
      measurements: [{ id: uuid(22), subjectRef: uuid(2), originalEvidenceRef: uuid(10) }],
      relations: [{ id: uuid(23), relationType: "承托", evidenceRefs: [uuid(10)] }],
    });
    const edges = new Map<string, Set<string>>();
    evidenceToFact(input, edges);
    expect([...(edges.get(uuid(10)) ?? [])].sort()).toEqual([uuid(20), uuid(21), uuid(22), uuid(23)].sort());
  });

  it("factToConstraint：事实与资料到几何规格，archetype 前缀不建边", () => {
    const input = withSnapshot({
      evidences: [evidence(uuid(10))],
      facts: [fact(uuid(20), [])],
      geometrySpecs: [spec(uuid(30), [geometryObject([uuid(20), "archetype:qing-gongcheng-zuofa:columnHeight"], [uuid(10)])])],
    });
    const graph = buildDependencyGraph(input);
    const edges = new Map<string, Set<string>>();
    const counted = factToConstraint(input, edges, graph.index);
    expect([...(edges.get(uuid(20)) ?? [])]).toEqual([uuid(30)]);
    expect([...(edges.get(uuid(10)) ?? [])]).toEqual([uuid(30)]);
    expect(edges.has("archetype:qing-gongcheng-zuofa:columnHeight")).toBe(false);
    expect(counted.archetype).toBe(1);
    expect(counted.unresolved).toBe(0);
  });

  it("factToConstraint：指向不存在记录的引用计入无法解析", () => {
    const input = withSnapshot({
      geometrySpecs: [spec(uuid(30), [geometryObject(["demo:v3-entity:" + uuid(99)], [])])],
    });
    const graph = buildDependencyGraph(input);
    expect(graph.unresolvedRefCount).toBe(1);
    expect(graph.archetypeRefCount).toBe(0);
  });

  it("constraintToGeometry：几何规格到几何版本", () => {
    const input = withSnapshot({
      geometrySpecs: [spec(uuid(30), [])],
      geometryRevisions: [{ id: uuid(40), geometrySpecId: uuid(30) }],
    });
    const edges = new Map<string, Set<string>>();
    constraintToGeometry(input, edges);
    expect([...(edges.get(uuid(30)) ?? [])]).toEqual([uuid(40)]);
  });

  it("geometryToView：几何版本到成果", () => {
    const input = { ...emptyInput(), artifacts: [artifact(uuid(50), uuid(40))] as never };
    const edges = new Map<string, Set<string>>();
    geometryToView(input, edges);
    expect([...(edges.get(uuid(40)) ?? [])]).toEqual([uuid(50)]);
  });

  it("viewToArtifact：出图依据与任务要求到成果", () => {
    const base = withSnapshot({ evidences: [evidence(uuid(10))] });
    const input = { ...base, artifacts: [artifact(uuid(50), uuid(40), [uuid(10), uuid(98)], uuid(60))] as never };
    const graph = buildDependencyGraph(input);
    const edges = new Map<string, Set<string>>();
    const unresolved = viewToArtifact(input, edges, graph.index);
    expect([...(edges.get(uuid(10)) ?? [])]).toEqual([uuid(50)]);
    expect([...(edges.get(uuid(60)) ?? [])]).toEqual([uuid(50)]);
    expect(unresolved).toBe(1);
  });

  it("artifactToCheck：成果与几何版本到检查", () => {
    const input = {
      ...emptyInput(),
      checkRuns: [{ id: uuid(70), geometryRevisionId: uuid(40), artifactRefs: [uuid(50)], results: [] }] as never,
    };
    const edges = new Map<string, Set<string>>();
    artifactToCheck(input, edges);
    expect([...(edges.get(uuid(40)) ?? [])]).toEqual([uuid(70)]);
    expect([...(edges.get(uuid(50)) ?? [])]).toEqual([uuid(70)]);
  });

  it("checkToDelivery：检查与成果到交付评估与草案", () => {
    const input = {
      ...emptyInput(),
      deliveryEvaluations: [{ id: uuid(80), geometryRevisionId: uuid(40), artifactRefs: [uuid(50)], checkRunRefs: [uuid(70)], outcome: "proxy-ready" }] as never,
      deliveries: [{ id: uuid(81), evaluationId: uuid(80), artifactRefs: [uuid(50)], restrictions: ["不可用于施工"], status: "proxy-unissued", signatureStatus: "unsigned" }] as never,
    };
    const edges = new Map<string, Set<string>>();
    checkToDelivery(input, edges);
    expect([...(edges.get(uuid(70)) ?? [])]).toEqual([uuid(80)]);
    expect([...(edges.get(uuid(80)) ?? [])]).toEqual([uuid(81)]);
    expect([...(edges.get(uuid(50)) ?? [])].sort()).toEqual([uuid(80), uuid(81)].sort());
  });
});

/** 从资料一路串到交付草案的一条完整链，供闭包用例复用 */
function fullChain(): ImpactGraphInput {
  const base = withSnapshot({
    evidences: [evidence(uuid(10))],
    facts: [fact(uuid(20), [uuid(10)])],
    geometrySpecs: [spec(uuid(30), [geometryObject([uuid(20)], [uuid(10)])])],
    geometryRevisions: [{ id: uuid(40), geometrySpecId: uuid(30) }],
  });
  return {
    ...base,
    artifacts: [artifact(uuid(50), uuid(40))] as never,
    checkRuns: [{ id: uuid(70), geometryRevisionId: uuid(40), artifactRefs: [uuid(50)], results: [] }] as never,
    deliveryEvaluations: [{ id: uuid(80), geometryRevisionId: uuid(40), artifactRefs: [uuid(50)], checkRunRefs: [uuid(70)], outcome: "proxy-ready" }] as never,
    deliveries: [{ id: uuid(81), evaluationId: uuid(80), artifactRefs: [uuid(50)], restrictions: ["不可用于施工"], status: "proxy-unissued", signatureStatus: "unsigned" }] as never,
  };
}

describe("下游闭包", () => {
  it("从资料出发走通整条链", () => {
    const result = computeImpact(fullChain(), [uuid(10)]);
    expect(result.groups.map((group) => group.kind).sort())
      .toEqual(["尺寸记录", "交付评估", "交付草案", "模型版本", "模型规格", "成果", "检查"].sort());
    expect(result.total).toBe(7);
  });

  it("只向下游走，不回头", () => {
    // 从成果出发，闭包里只能有检查与交付，不能有它上游的几何版本、事实、资料
    const result = computeImpact(fullChain(), [uuid(50)]);
    const kinds = result.groups.map((group) => group.kind);
    expect(kinds).not.toContain("模型版本");
    expect(kinds).not.toContain("尺寸记录");
    expect(kinds).not.toContain("资料");
    expect(kinds.sort()).toEqual(["交付草案", "交付评估", "检查"].sort());
  });

  it("起点自己不算受影响", () => {
    const result = computeImpact(fullChain(), [uuid(10), uuid(20)]);
    const names = result.groups.flatMap((group) => group.names);
    expect(names).not.toContain("资料 10");
    expect(result.groups.map((group) => group.kind)).not.toContain("资料");
  });

  it("没有下游时闭包为空，不报错", () => {
    const input = withSnapshot({ evidences: [evidence(uuid(10))] });
    const result = computeImpact(input, [uuid(10)]);
    expect(result.total).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.coverageGaps).toEqual([]);
  });

  it("空输入返回空结构而不是报错", () => {
    expect(previewImpact(emptyInput(), []).total).toBe(0);
    expect(previewImpact(fullChain(), []).total).toBe(0);
  });

  it("数据里有环时不死循环", () => {
    // 成果 A 的 sourceRefs 指向成果 B，成果 B 的指向成果 A
    const base = emptyInput();
    const input = {
      ...base,
      artifacts: [
        artifact(uuid(50), uuid(40), [uuid(51)]),
        artifact(uuid(51), uuid(40), [uuid(50)]),
      ] as never,
    };
    const result = computeImpact(input, [uuid(50)]);
    expect(result.groups.find((group) => group.kind === "成果")?.count).toBe(1);
  });

  it("已交付草案列出但不计入失效", () => {
    const chain = fullChain();
    const issued = {
      ...chain,
      deliveries: [{ ...(chain.deliveries[0] as Record<string, unknown>), signatureStatus: "signed" }] as never,
    };
    const result = computeImpact(issued, [uuid(10)]);
    expect(result.groups.map((group) => group.kind)).not.toContain("交付草案");
    expect(result.preserved.map((group) => group.kind)).toEqual(["交付草案"]);
  });

  it("名称清单超过二十条时截断，截断数写进结构", () => {
    const many = Array.from({ length: 25 }, (_, index) => artifact(uuid(100 + index), uuid(40)));
    const base = withSnapshot({ geometryRevisions: [{ id: uuid(40), geometrySpecId: uuid(30) }] });
    const result = computeImpact({ ...base, artifacts: many as never }, [uuid(40)]);
    const group = result.groups.find((one) => one.kind === "成果");
    expect(group?.count).toBe(25);
    expect(group?.names).toHaveLength(20);
    expect(result.truncatedNameCount).toBe(5);
  });
});

describe("算不全时结果自己说出来", () => {
  // 起点是几何上游那几类记录时才报，起点在下游时那条断链与本次无关，报出来只是噪声
  it("起点是事实且有 archetype 引用时给出覆盖缺口说明", () => {
    const input = withSnapshot({
      facts: [fact(uuid(20), [])],
      geometrySpecs: [spec(uuid(30), [geometryObject(["archetype:qing-gongcheng-zuofa:columnHeight"], [])])],
    });
    const result = computeImpact(input, [uuid(20)]);
    expect(result.coverageGaps).toHaveLength(1);
    expect(result.coverageGaps[0]).toContain("取自形制推算");
  });

  it("起点在下游时不报覆盖缺口", () => {
    const base = withSnapshot({
      facts: [fact(uuid(20), [])],
      geometrySpecs: [spec(uuid(30), [geometryObject(["archetype:qing-gongcheng-zuofa:columnHeight"], [])])],
      geometryRevisions: [{ id: uuid(40), geometrySpecId: uuid(30) }],
    });
    const input = { ...base, artifacts: [artifact(uuid(50), uuid(40))] as never };
    expect(computeImpact(input, [uuid(50)]).coverageGaps).toEqual([]);
  });

  it("没有 archetype 引用时覆盖缺口为空", () => {
    expect(computeImpact(fullChain(), [uuid(10)]).coverageGaps).toEqual([]);
  });

  it("无法解析的引用出现在结构里，不被丢掉", () => {
    const input = withSnapshot({
      evidences: [evidence(uuid(10))],
      geometrySpecs: [spec(uuid(30), [geometryObject(["demo:v3-entity:x", "demo:v3-entity:y"], [])])],
    });
    const result = computeImpact(input, [uuid(10)]);
    expect(result.unresolvedRefCount).toBe(2);
    expect(result.coverageGaps.join()).toContain("找不到对应记录");
  });
});
