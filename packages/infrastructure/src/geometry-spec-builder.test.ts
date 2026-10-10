import type { ProjectHead } from "@gujian/application";
import { describe, expect, it } from "vitest";

import { buildProjectGeometrySpec, geometryPrerequisites } from "./geometry-spec-builder.js";

it.each(["mm", "cm", "m"] as const)("事实派生采用任务单位 %s，内部长度和来源保持毫米", (outputUnit) => {
  const current = head(); const buildingId = current.snapshot.buildings[0]!.id;
  current.snapshot.taskDefinitions[0]!.productionSetup = { buildingId, purpose: "existingSurvey", outputUnit, targets: ["model", "floorPlan"], projectGroup: null };
  const expected = buildProjectGeometrySpec({ ...current, snapshot: { ...current.snapshot, taskDefinitions: current.snapshot.taskDefinitions.map((task) => ({ ...task, productionSetup: { ...task.productionSetup!, outputUnit: "mm" } })) } }, crypto.randomUUID());
  const result = buildProjectGeometrySpec(current, crypto.randomUUID());
  expect(result.outputUnit).toBe(outputUnit); expect(result.coordinateSystem.lengthUnit).toBe("mm");
  expect(result.objects.map((item) => [item.stableKey, item.solid, item.factRefs, item.evidenceRefs])).toEqual(expected.objects.map((item) => [item.stableKey, item.solid, item.factRefs, item.evidenceRefs]));
});

function head(): ProjectHead {
  const projectId = crypto.randomUUID();
  const buildingId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const wallEvidenceId = crypto.randomUUID();
  const supportEvidenceId = crypto.randomUUID();
  const wallFactId = crypto.randomUUID();
  const supportFactId = crypto.randomUUID();
  return {
    projectId, revisionId, auditEventId: crypto.randomUUID(),
    snapshot: {
      schemaVersion: "3.0",
      project: { id: projectId, name: "证据几何测试", status: "active", locationText: null, createdAt: "2026-08-14T00:00:00Z" },
      buildings: [{ id: buildingId, projectId, name: "测试建筑", periodText: null, addressText: null, status: "existing" }],
      taskDefinitions: [{
        id: crypto.randomUUID(), name: "代理几何", scope: ["有证据构件"], regulationRefs: [], deliverables: ["平面"],
        responsibilities: [{ role: "projectLead", actorId }], automationPolicyRef: null, confirmedAt: "2026-08-14T00:00:00Z",
        artifactRequirements: {
          titleZh: "测试代理成果", revisionLabel: "P1", geometryTargetRoles: ["wall", "support"],
          sheets: [{ key: "sheet", drawingNumber: "P-01", displayLabelZh: "平面", pageMm: [420, 297] }],
          views: [{ key: "plan", displayLabelZh: "平面", drawingRef: "平-01", kind: "floorPlan", scaleDenominator: 50, sheetKey: "sheet", viewportRectMm: [20, 20, 380, 250], direction: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], targetStableKeys: ["wall:east", "post:east"], sourceEvidenceRefs: [wallEvidenceId, supportEvidenceId] }],
        },
      }],
      evidences: [
        { id: wallEvidenceId, projectId, assetId: crypto.randomUUID(), evidenceType: "drawing", title: "图纸第 3 张", rightsDeclaration: null, intendedUse: null, recordedAt: null, relatedEntityRefs: [], dataStatus: "available" },
        { id: supportEvidenceId, projectId, assetId: crypto.randomUUID(), evidenceType: "drawing", title: "图纸第 10 张", rightsDeclaration: null, intendedUse: null, recordedAt: null, relatedEntityRefs: [], dataStatus: "available" },
      ],
      parseRecords: [], entities: [], exclusionRecords: [], relations: [], observations: [], measurements: [], candidates: [], issues: [], dependencyEdges: [], geometrySpecs: [], geometryRevisions: [], reviewSignoffs: [], adoptedRecordRefs: [],
      facts: [
        {
          id: wallFactId, subjectRef: buildingId, field: "geometry.component.wall:east", reviewStatus: "confirmed", dataStatus: "available",
          producer: { producerType: "human", actorId, actionRef: { commandId: crypto.randomUUID() } }, evidenceRefs: [wallEvidenceId],
          value: {
            stableKey: "wall:east", parentStableKey: null, componentType: "wall", displayNameZh: "东墙可证墙段", materialCode: "bousillage-documented",
            solid: { kind: "box", sizeX: "177.8", sizeY: "6273.8", sizeZ: "2755.9", centerMm: [4676.775, 0, 1377.95] }, parameters: [],
            sourceLocation: "sheet 3, floor plan and plan detail; sheet 4 level", evidenceRefs: [wallEvidenceId],
            unknowns: [{ reasonCode: "WALL_CONNECTION_UNRESOLVED", description: "墙顶连接未完成逐项转写。", requiredEvidence: ["sheets 6–8 wall sections"], affectedStableKeys: ["wall:east"], blocksProxyOutcome: false, blocksFormalEligibility: true }],
          },
        },
        {
          id: supportFactId, subjectRef: buildingId, field: "geometry.component.post:east", reviewStatus: "confirmed", dataStatus: "available",
          producer: { producerType: "human", actorId, actionRef: { commandId: crypto.randomUUID() } }, evidenceRefs: [supportEvidenceId],
          value: {
            stableKey: "post:east", parentStableKey: null, componentType: "support", displayNameZh: "东侧木柱", materialCode: "cypress-documented",
            solid: { kind: "box", sizeX: "127", sizeY: "127", sizeZ: "2755.9", centerMm: [0, 0, 1377.95] }, parameters: [],
            sourceLocation: "sheet 10, wall framing isometric, 5 inch post callout", evidenceRefs: [supportEvidenceId], unknowns: [],
          },
        },
      ],
    },
  };
}

describe("evidence-bound geometry spec", () => {
  it("仅模型任务不要求出图配置，保留单位与逐构件依据", () => {
    const current = head();
    const task = current.snapshot.taskDefinitions[0]!;
    delete task.artifactRequirements;
    task.productionSetup = { buildingId: current.snapshot.buildings[0]!.id, purpose: "existingSurvey", outputUnit: "cm", targets: ["model"], projectGroup: null };
    expect(geometryPrerequisites(current).ready).toBe(true);
    const spec = buildProjectGeometrySpec(current, crypto.randomUUID());
    expect(spec.outputUnit).toBe("cm");
    expect(spec.objects[0]!.evidenceRefs).toEqual(current.snapshot.facts[0]!.evidenceRefs);
    expect(spec.objects).toHaveLength(2);
    task.confirmedAt = null;
    expect(geometryPrerequisites(current).missing).toContain("task.confirmed");
    expect(() => buildProjectGeometrySpec(current, crypto.randomUUID())).toThrow("GEOMETRY_EVIDENCE_FACTS_MISSING");
  });
  it("逐构件只继承其具体事实和证据，不扩散到全部资料", () => {
    const current = head();
    expect(geometryPrerequisites(current).ready).toBe(true);
    const spec = buildProjectGeometrySpec(current, crypto.randomUUID());
    const wall = spec.objects.find((item) => item.stableKey === "wall:east")!;
    const support = spec.objects.find((item) => item.stableKey === "post:east")!;
    expect(wall.factRefs).toEqual([current.snapshot.facts[0]!.id]);
    expect(wall.evidenceRefs).toEqual([current.snapshot.evidences[0]!.id]);
    expect(support.evidenceRefs).toEqual([current.snapshot.evidences[1]!.id]);
    expect(spec.unknowns.map((item) => item.reasonCode)).toContain("WALL_CONNECTION_UNRESOLVED");
    expect(JSON.stringify(spec)).not.toContain("stone-proxy");
  });

  it("仅有五个总尺寸时阻断，不推导墙厚、出檐和构造层", () => {
    const current = head();
    current.snapshot.facts = ["overallWidthMm", "overallDepthMm", "baseHeightMm", "wallHeightMm", "ridgeHeightMm"].map((field) => ({
      id: crypto.randomUUID(), subjectRef: current.snapshot.buildings[0]!.id, field: `geometry.${field}`, value: 1000,
      producer: { producerType: "human" as const, actorId: crypto.randomUUID(), actionRef: { commandId: crypto.randomUUID() } }, evidenceRefs: [current.snapshot.evidences[0]!.id], reviewStatus: "confirmed" as const, dataStatus: "available" as const,
    }));
    expect(geometryPrerequisites(current).ready).toBe(false);
    expect(() => buildProjectGeometrySpec(current, crypto.randomUUID())).toThrow("GEOMETRY_EVIDENCE_FACTS_MISSING");
  });
});

function boundHead(solid?: Record<string, unknown>, field = "sizeX") {
  const current = head();
  const source = {
    id: crypto.randomUUID(), subjectRef: current.snapshot.buildings[0]!.id, field: "documentedDimension.candidate.test.0",
    value: { name: "测试长度", value: 123.45, unit: "mm", disposition: "adopt" },
    producer: { producerType: "model" as const, runId: crypto.randomUUID() },
    evidenceRefs: [current.snapshot.evidences[1]!.id], reviewStatus: "confirmed" as const, dataStatus: "available" as const,
  };
  current.snapshot.facts.push(source);
  const component = current.snapshot.facts[0]!.value as Record<string, unknown>;
  component.dimensionBindings = [{ field, sourceFactRef: source.id }];
  component.positionBasis = "human";
  component.conceptRef = "wall-test-concept";
  if (solid) component.solid = solid;
  return { current, source, component };
}
describe("构件尺寸引用", () => {
  it("实际生成规格使用采用值及其资料，修订时取最新值且旧规格不变", () => {
    const { current, source } = boundHead();
    const before = buildProjectGeometrySpec(current, crypto.randomUUID());
    const wall = before.objects[0]!;
    expect(wall.solid).toMatchObject({ kind: "box", sizeX: "123.45" });
    expect(wall.factRefs).toContain(source.id);
    expect(wall.evidenceRefs).toContain(source.evidenceRefs[0]);
    expect(wall.positionBasis).toBe("human");
    expect(wall.conceptRef).toBe("wall-test-concept");
    expect(wall.parameters.find((item) => item.name === "X 向长度")).toMatchObject({ exactValue: "123.45", basis: "human", factRefs: [source.id] });
    const revised = { ...source, id: crypto.randomUUID(), value: { ...source.value, value: 234.56 } };
    current.snapshot.facts.push(revised);
    const after = buildProjectGeometrySpec(current, crypto.randomUUID());
    expect(after.objects[0]!.solid).toMatchObject({ sizeX: "234.56" });
    expect(after.objects[0]!.factRefs).toContain(revised.id);
    expect(after.objects[0]!.factRefs).not.toContain(source.id);
    expect(before.objects[0]!.solid).toMatchObject({ sizeX: "123.45" });
  });
  it.each(["reject", "stale", "missing", "unit", "zero", "nonfinite"])("最新处置为 %s 时停止，不退回旧值", (status) => {
    const { current, source } = boundHead();
    const revised = { ...source, id: crypto.randomUUID(), value: { ...source.value }, reviewStatus: source.reviewStatus as "confirmed" | "rejected", dataStatus: source.dataStatus as "available" | "stale" };
    if (status === "reject") revised.reviewStatus = "rejected";
    if (status === "stale") revised.dataStatus = "stale";
    if (status === "missing") current.snapshot.facts = current.snapshot.facts.filter((fact) => fact.id !== source.id);
    if (status === "unit") revised.value.unit = "m";
    if (status === "zero") revised.value.value = 0;
    if (status === "nonfinite") revised.value.value = NaN;
    current.snapshot.facts.push(revised);
    expect(() => buildProjectGeometrySpec(current, crypto.randomUUID())).toThrow("GEOMETRY_DIMENSION_BINDING_INVALID");
  });
  it.each([
    [{ kind: "cylinder", radius: "10", height: "20", axis: "z", centerMm: [0, 0, 0] }, "height"],
    [{ kind: "extrudedProfile", profileMm: [[0, 0], [1, 0], [0, 1]], depth: "10", axis: "y", originMm: [0, 0, 0] }, "depth"],
  ] as const)("圆柱与轮廓挤出使用相同的引用规则", (solid, field) => {
    const { current } = boundHead(structuredClone(solid), field);
    const result = buildProjectGeometrySpec(current, crypto.randomUUID());
    expect(result.objects[0]!.solid).toMatchObject({ [field]: "123.45" });
  });
  it("不允许不匹配的长度字段、重复引用或失效资料", () => {
    const { current, component, source } = boundHead();
    component.dimensionBindings = [{ field: "radius", sourceFactRef: source.id }];
    expect(() => buildProjectGeometrySpec(current, crypto.randomUUID())).toThrow("引用字段");
    component.dimensionBindings = [{ field: "sizeX", sourceFactRef: source.id }, { field: "sizeX", sourceFactRef: source.id }];
    expect(() => buildProjectGeometrySpec(current, crypto.randomUUID())).toThrow("重复引用");
    component.dimensionBindings = [{ field: "sizeX", sourceFactRef: source.id }];
    current.snapshot.evidences[1]!.dataStatus = "missing";
    expect(() => buildProjectGeometrySpec(current, crypto.randomUUID())).toThrow("资料缺失");
  });
  it("很小的长度不使用科学计数法，也不丢失原组件参数", () => {
    const { current, source, component } = boundHead();
    source.value.value = 0.0000001;
    component.parameters = [{ id: crypto.randomUUID(), name: "原说明", valueType: "text", value: "保留", unit: "1", basis: "human", factRefs: [], evidenceRefs: [] }];
    const result = buildProjectGeometrySpec(current, crypto.randomUUID());
    expect(result.objects[0]!.solid).toMatchObject({ sizeX: "0.0000001" });
    expect(result.objects[0]!.parameters.find((item) => item.name === "原说明")).toMatchObject({ value: "保留" });
  });
});
