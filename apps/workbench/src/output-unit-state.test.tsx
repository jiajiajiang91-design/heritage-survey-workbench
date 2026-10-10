import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { ArtifactRecordSchema, ProjectDrivenGeometrySpecSchema, type GeometryRevision } from "@gujian/domain";
import { buildArtifactMatrix, buildProjectGeometrySpec, rebindExistingGeometrySpec, recordHash } from "@gujian/infrastructure";
import { componentCandidateFixture } from "./test/component-candidate-fixture";
import { commitGeometryFacts } from "./geometry-fact-service";
import { emptyProductionTask } from "./production-task";
import { localActorId, projectCommands, projectRepository, projectPackages, saveProductionTask } from "./workbench";
import { commitDimensionReviews } from "./dimension-review";
import { buildArtifactSetView, buildProjectDashboardSummary } from "./query-models";
import { ModelView, type ModelViewProps } from "./screens/ModelView";
import { DrawingSet } from "./screens/DrawingSet";
import { SheetStyle } from "./screens/SheetStyle";
import { useAssistantBridge } from "./workbench/useAssistantBridge";
afterEach(cleanup);
async function fixture() {
  const source = await componentCandidateFixture();
  let head = (await commitDimensionReviews({ head: source.head, candidate: source.candidate, drafts: [{ rowIndex: 0, disposition: "adopt", name: "总宽", valueMm: "6100.5", checked: true, reason: "内部小数单位换算验证，非真实测量" }], actorId: localActorId(), commands: projectCommands, repository: projectRepository })).head!;
  const inputs = source.inputs.map((input) => input.dimensionBindings ? { ...input, dimensionBindings: input.dimensionBindings.map((binding) => ({ ...binding, sourceFactRef: head.snapshot.facts.at(-1)!.id })) } : input);
  head = await saveProductionTask(head, { ...emptyProductionTask(), taskName: "单元23 输出单位内部测试", buildingName: "内部单位建筑" });
  head = (await commitGeometryFacts({ head, values: { components: inputs, interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository })).head!;
  const spec = buildProjectGeometrySpec(head, crypto.randomUUID());
  const geometry: GeometryRevision = { id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: head.revisionId, geometrySpecId: spec.id, inputHash: spec.inputHash,
    entityClosureHash: "a".repeat(64), interfaceClosureHash: "b".repeat(64), geometrySignature: "c".repeat(64), assets: [], status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, blockers: ["PROFESSIONAL_REVIEW_REQUIRED"], createdAt: spec.createdAt };
  head = { ...head, snapshot: { ...head.snapshot, geometrySpecs: [spec], geometryRevisions: [geometry] } };
  const matrix = buildArtifactMatrix(head, geometry, spec);
  const artifact = ArtifactRecordSchema.parse({ id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: head.revisionId, geometryRevisionId: geometry.id, requirementMatrixId: matrix.id,
    kind: "svg", fileName: "内部.svg", assetId: crypto.randomUUID(), sha256: "d".repeat(64), mimeType: "image/svg+xml", byteLength: 1, status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, sourceRefs: [matrix.id], blockers: ["PROFESSIONAL_REVIEW_REQUIRED"], createdAt: spec.createdAt });
  return { source, head, spec, geometry, matrix, artifact };
}
it("旧规格无单位读取不改哈希，重绑新单位保留毫米对象与来源", async () => {
  const test = await fixture(); const legacy = { ...test.spec }; delete legacy.outputUnit;
  const hash = recordHash(legacy); expect(recordHash(ProjectDrivenGeometrySpecSchema.parse(legacy))).toBe(hash);
  test.head.snapshot.taskDefinitions[0]!.productionSetup!.outputUnit = "m";
  const result = rebindExistingGeometrySpec(test.head, legacy);
  expect(result.outputUnit).toBe("m"); expect(result.objects).toEqual(legacy.objects); expect(result.coordinateSystem.lengthUnit).toBe("mm");
  expect(result.inputHash).toBe(recordHash({ ...result, inputHash: "0".repeat(64) }));
  if (process.env.OUTPUT_UNIT_FIXTURE_OUT) {
    const bytes = await projectPackages.exportJson(test.head.projectId);
    projectPackages.parse(bytes, "internal.json");
    writeFileSync(`${process.env.OUTPUT_UNIT_FIXTURE_OUT}.json`, bytes);
    const assets = await projectRepository.getProjectAssets(test.head.projectId);
    writeFileSync(`${process.env.OUTPUT_UNIT_FIXTURE_OUT}.assets.json`, JSON.stringify(await Promise.all(assets.map(async ({record,content}) => ({ id: record.id, bytes: content ? Array.from(new Uint8Array(await content.arrayBuffer())) : null })))));
  }
});
it("旧成果排除；旧毫米几何可按新单位出图，新文件不被历史文件永久阻断", async () => {
  const test = await fixture(); const input = { head: test.head, artifacts: [test.artifact], requirementMatrices: [test.matrix], modelRuns: [], ruleRuns: [], decisions: [], checks: [], evaluations: [], deliveries: [] };
  expect(buildArtifactSetView(input).currentArtifacts).toEqual([test.artifact]);
  test.head.snapshot.taskDefinitions[0]!.productionSetup!.outputUnit = "cm";
  expect(buildArtifactSetView(input).currentArtifacts).toEqual([]); expect(buildProjectDashboardSummary(input).blockerCodes).toContain("OUTPUT_UNIT_CHANGED");
  const nextMatrix = buildArtifactMatrix(test.head, test.geometry, test.spec); expect(nextMatrix.outputUnit).toBe("cm"); expect(test.spec.outputUnit).toBe("mm");
  const nextArtifact = { ...test.artifact, id: crypto.randomUUID(), requirementMatrixId: nextMatrix.id };
  input.artifacts.push(nextArtifact); input.requirementMatrices.push(nextMatrix);
  expect(buildArtifactSetView(input).currentArtifacts).toEqual([nextArtifact]);
  test.head.snapshot.geometrySpecs[0] = { ...test.spec, outputUnit: "cm" };
  expect(buildProjectDashboardSummary(input).blockerCodes).not.toContain("OUTPUT_UNIT_CHANGED");
  expect(input.artifacts).toHaveLength(2);
});
it("模型界面和助手实际快照说明单位待更新，历史文件不计完成", async () => {
  const test = await fixture(); test.head.snapshot.taskDefinitions[0]!.productionSetup!.outputUnit = "m";
  const props = { snapshot: test.head.snapshot, geometrySpec: test.spec, geometryRevision: test.geometry, geometryBlob: null, geometryGate: { ready: true, missing: [] }, signedOff: false,
    jobs: { geometryRunning: false, showGeometryTask: false }, typeLabel: (type: string) => type, selectedObjectId: null, onSelectObject: vi.fn(), onEditComponents: vi.fn() } as unknown as ModelViewProps;
  render(<ModelView {...props} />); expect(screen.getByRole("status")).toHaveTextContent("输出单位已改为米"); expect(screen.getByRole("status")).toHaveTextContent("仍为毫米");
  const deps = { session: { selected: test.head, geometrySpec: test.spec, openIssues: [], projectCards: [], projectArtifacts: [test.artifact], projectRequirementMatrices: [test.matrix], projectDeliveries: [], projectModelRuns: [], projectRuleRuns: [], projectDecisions: [], projectCheckRuns: [], projectDeliveryEvaluations: [], parsedEvidenceCount: 1 },
    nav: { activeStage: "geometry", selectedGeometryEntity: null }, jobs: {}, evidence: { imageSelection: null }, writes: { assistantExecutors: {} }, notices: {} } as unknown as Parameters<typeof useAssistantBridge>[0];
  const { result } = renderHook(() => useAssistantBridge(deps)); const snapshot = result.current.buildAssistantSnapshot();
  expect(snapshot.hasGeometryRevision).toBe(false); expect(snapshot.hasDrawings).toBe(false); expect(snapshot.hasDeliverable).toBe(false);
  expect(snapshot.contextZh).toContain("当前适用成果文件 0 项，历史文件共 1 项"); expect(snapshot.contextZh).toContain("模型文件待重新生成");
});
it("图纸单位变更显示已有历史，仍可按当前单位发起出图", () => {
  const generate = vi.fn();
  render(<DrawingSet artifacts={[]} previews={[]} latestCheckRun={null} hasGeometry hasTask generating={false} showTask={false} progressPhase={null} cancelling={false}
    onGenerate={generate} onCancel={vi.fn()} onDownload={vi.fn()} signoff={null} demoLimitationZh={null} outputUnitChanged />);
  expect(screen.getByRole("status")).toHaveTextContent("旧图纸已保留");
  expect(screen.getByRole("button", { name: "按成果目录生成" })).toBeEnabled();
  expect(screen.queryByText("还没有图纸。", { exact: false })).toBeNull();
});
it("图纸设置显示任务当前长度单位", async () => {
  const test = await fixture(); test.head.snapshot.taskDefinitions[0]!.productionSetup!.outputUnit = "cm";
  render(<SheetStyle task={test.head.snapshot.taskDefinitions[0]!} references={{ evidences: [], dimensions: [], components: [], sections: [] } as unknown as Parameters<typeof SheetStyle>[0]["references"]} roleOptions={[]} onSubmitTask={vi.fn()} previews={[]} canGenerate generating={false} onGenerate={vi.fn()} onEditTask={vi.fn()} />);
  expect(screen.getByText("长度输出单位")).toBeInTheDocument(); expect(screen.getByText("厘米", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText("毫米，全项目固定")).toBeNull();
});
