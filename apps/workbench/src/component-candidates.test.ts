// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildProjectGeometrySpec, CadJobClient, componentCandidateProblem, geometryGenerationGate, rebindExistingGeometrySpec, IndexedDbProjectRepository, ProjectPackageService, openWorkbenchDatabase, sha256Hex } from "@gujian/infrastructure";
import { Buffer } from "node:buffer";
import type { ProjectHead } from "@gujian/application";
import { candidateComponentDraft, componentDraft, componentInputs, buildComponentInput } from "./component-input";
import { componentCandidateFixture } from "./test/component-candidate-fixture";
import { commitGeometryFacts } from "./geometry-fact-service";
import { localActorId, projectCommands, projectRepository, projectPackages, workflow } from "./workbench";
import { buildPreviewReadModel } from "./preview-read-model";
import { objectSourceModel } from "./object-source-model";
import { commitDimensionReviews } from "./dimension-review";
import { evidenceReadability } from "./evidence-readability";
const actor = crypto.randomUUID();
vi.stubGlobal("localStorage", { getItem: () => actor, setItem: () => undefined });
async function prepared() {
  const test = await componentCandidateFixture();
  const saved = await commitGeometryFacts({ head: test.head, values: { components: test.inputs, interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository });
  return { ...test, head: saved.head! };
}
async function imageHead(head: ProjectHead) {
  const evidence = head.snapshot.evidences[0]!; const original = (await projectRepository.getProjectAssets(head.projectId))[0]!.record;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCj0AAAAASUVORK5CYII=", "base64");
  const content = new Blob([new Uint8Array(bytes)]); const session = crypto.randomUUID();
  const asset = { ...original, id: crypto.randomUUID(), fileName: "内部派生图.png", mimeType: "image/png", byteLength: content.size, sha256: await sha256Hex(new Uint8Array(bytes)) };
  await projectRepository.stageAssets(session, [asset], new Map([[asset.id, content]]));
  await projectCommands.execute({ commandType: "ProcessEvidence", commandId: crypto.randomUUID(), projectId: head.projectId, actorId: localActorId(), expectedRevisionId: head.revisionId, issuedAt: new Date().toISOString(), payload: {
    evidence: { ...evidence, imageDerivative: { assetId: asset.id, originalSha256: original.sha256, pixelSha256: "b".repeat(64), sourceSizePixels: [1, 1], derivedSizePixels: [1, 1], mode: "RGB", coordinateMapping: "identity" } },
    parseRecord: { ...head.snapshot.parseRecords[0]!, id: crypto.randomUUID(), parser: "internal-readability-test", status: "metadataOnly", extractedText: null, readability: "readable", readableAs: "image" }, derivedAsset: asset, stagingSessionId: session,
  } });
  return (await projectRepository.getProjectHead(head.projectId))!;
}
async function retryImage(head: ProjectHead, state: "failed" | "unsupported" | "readable") {
  const { readableAs: _kind, ...record } = head.snapshot.parseRecords.at(-1)!;
  await projectCommands.execute({ commandType: "ProcessEvidence", commandId: crypto.randomUUID(), projectId: head.projectId, actorId: localActorId(), expectedRevisionId: head.revisionId, issuedAt: new Date().toISOString(), payload: {
    evidence: head.snapshot.evidences[0]!, parseRecord: { ...record, id: crypto.randomUUID(), status: state === "failed" ? "failed" : "metadataOnly", extractedText: null, readability: state, ...(state === "readable" ? { readableAs: "image" as const } : {}) },
  } });
  return workflow.evaluate((await projectRepository.getProjectHead(head.projectId))!, localActorId());
}
describe("识别构件与制作输入关联", () => {
  it("首次只沿用可见名称、明确类型和原件，未知三维参数保持空白", async () => {
    const test = await componentCandidateFixture();
    const selection = { candidateId: test.recognition.id, rowIndex: 0 };
    const draft = candidateComponentDraft(test.head.snapshot, selection)!;
    expect(draft.name).toBe("内部墙体"); expect(draft.componentType).toBe("wall");
    expect(draft.candidateSource).toEqual(selection); expect(draft.evidenceRefs).toEqual(test.component.evidenceRefs);
    expect(draft.coordinates).toEqual(["", "", ""]); expect(draft.lengths.sizeX).toBe(""); expect(draft.material).toBe("");
    expect(candidateComponentDraft(test.head.snapshot, selection)!.stableKey).toBe(draft.stableKey);
    const copy = structuredClone(test.head.snapshot); const output = copy.candidates.find((row) => row.id === test.recognition.id)!.structured;
    if (output?.kind === "componentRecognition") output.components[0]!.categoryZh = "不明形制";
    expect(candidateComponentDraft(copy, selection)!.componentType).toBe("");
  });
  it("保存与重命名后再次打开编辑原输入，预览与 ZIP 保留同一来源和尺寸引用", async () => {
    const test = await prepared(); const selection = test.inputs[0]!.candidateSource!;
    const base = componentInputs(test.head.snapshot)[0]!; const draft = componentDraft(base); draft.name = "人工修订墙体";
    const value = buildComponentInput(test.head.snapshot, draft, base).value!;
    const saved = await commitGeometryFacts({ head: test.head, values: { components: [value], interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    expect(componentInputs(saved.head!.snapshot)).toHaveLength(2);
    const reopened = candidateComponentDraft(saved.head!.snapshot, selection)!;
    expect(reopened.name).toBe("人工修订墙体"); expect(reopened.stableKey).toBe(base.stableKey); expect(reopened.bindings.sizeX).toBe(test.dimension.id);
    const assets = (await projectRepository.getProjectAssets(test.head.projectId)).map(({ record }) => record);
    const preview = buildPreviewReadModel(saved.head!.snapshot, assets).rows.find((row) => row.candidateId === test.recognition.id && row.rowIndex === 0)!;
    expect(preview).toMatchObject({ name: "人工修订墙体", originalText: "内部墙体", status: "prepared", componentStableKey: base.stableKey });
    const bytes = await projectPackages.exportZip(test.head.projectId);
    const database = await openWorkbenchDatabase("unit21-restore-" + crypto.randomUUID());
    try {
      const repository = new IndexedDbProjectRepository(database);
      const service = new ProjectPackageService(repository);
      const id = await service.import(bytes, "internal.zip", localActorId());
      const restored = (await repository.getProjectHead(id))!;
      expect(candidateComponentDraft(restored.snapshot, selection)).toMatchObject({ name: reopened.name, stableKey: base.stableKey, candidateSource: selection, bindings: reopened.bindings });
      expect((await repository.getProjectAssets(id))[0]!.content).not.toBeNull();
    } finally { database.close(); }
  });
  it("错误项目、条目、编号或原件引用均不能写入", async () => {
    const test = await componentCandidateFixture(); const input = test.inputs[0]!;
    for (const value of [ { ...input, candidateSource: { candidateId: crypto.randomUUID(), rowIndex: 0 } },
      { ...input, candidateSource: { candidateId: test.recognition.id, rowIndex: 99 } }, { ...input, stableKey: "other-key" },
      { ...input, evidenceRefs: [crypto.randomUUID()] } ]) {
      expect(componentCandidateProblem(test.head.snapshot, value)).toBeTruthy();
      await expect(commitGeometryFacts({ head: test.head, values: { components: [value], interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository })).rejects.toThrow();
    }
    const snapshot = structuredClone(test.head.snapshot); snapshot.candidates.find((row) => row.id === test.recognition.id)!.projectId = crypto.randomUUID();
    expect(componentCandidateProblem(snapshot, input)).toContain("本项目");
  });
  it("候选驳回后新生成及旧规格重新生成均拒绝，历史模型和事实仍可查", async () => {
    const test = await prepared(); const spec = buildProjectGeometrySpec(test.head, crypto.randomUUID());
    const issue = test.head.snapshot.issues.find((row) => row.subjectRefs.includes(test.recognition.id))!;
    const head = await workflow.decideCandidate(test.head, localActorId(), { candidateId: test.recognition.id, issueId: issue.id, outcome: "rejected", reason: "内部来源失效测试" });
    head.snapshot.geometrySpecs.push(spec);
    expect(componentInputs(head.snapshot)).toEqual([]); expect(geometryGenerationGate(head).ready).toBe(false);
    expect(head.snapshot.facts.filter((fact) => fact.field.startsWith("geometry.component."))).toHaveLength(2);
    expect(() => rebindExistingGeometrySpec(head, spec)).toThrow("ORIGIN_UNAVAILABLE");
    const request = vi.fn(); const client = new CadJobClient({ repository: projectRepository, commands: projectCommands, fetchImpl: request });
    await expect(client.startGeometry(head, localActorId(), () => undefined, { mode: "existingGeometrySpec", geometrySpecId: spec.id })).rejects.toThrow("FACTS_MISSING");
    expect(request).not.toHaveBeenCalled();
    expect(objectSourceModel(head.snapshot, spec.objects[0]!).problem).toContain("驳回");
  });
  it("既有模型重新生成使用最新采用尺寸，不沿用旧规格尺寸", async () => {
    const test = await prepared(); const spec = buildProjectGeometrySpec(test.head, crypto.randomUUID());
    const saved = await commitDimensionReviews({ head: test.head, candidate: test.candidate, drafts: [{ rowIndex: 0, disposition: "adopt", name: "总宽", valueMm: "6100", checked: true, reason: "内部修改验证" }], actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    const head = saved.head!; head.snapshot.geometrySpecs.push(spec); let submitted: { geometrySpec: ReturnType<typeof buildProjectGeometrySpec> } | undefined;
    const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url).endsWith("/api/session")) return new Response(JSON.stringify({ csrfToken: "test", cadCapabilityToken: "test" }));
      submitted = JSON.parse(String(options?.body)); return new Response("内部测试在请求取得后停止", { status: 500 });
    });
    const client = new CadJobClient({ repository: projectRepository, commands: projectCommands, fetchImpl: request });
    await expect(client.startGeometry(head, localActorId(), () => undefined, { mode: "existingGeometrySpec", geometrySpecId: spec.id })).rejects.toThrow("START_FAILED");
    expect(submitted!.geometrySpec.objects.find((row) => row.stableKey === test.inputs[0]!.stableKey)!.solid).toMatchObject({ sizeX: "6100" });
    expect(spec.objects[0]!.solid).toMatchObject({ sizeX: "6000" });
    const source = objectSourceModel(head.snapshot, spec.objects[0]!);
    expect(source.dimensions[0]!.dimension!.valueMm).toBe(6100); expect(source.modelLengths[0]!.value).toBe("6000"); expect(source.dimensions[0]!.selection).toEqual({ candidateId: test.candidate.id, rowIndex: 0 });
  });
  it.each(["rejected", "superseded", "relativeElevation"])("尺寸来源变为 %s 时界面与新生成一致失效，历史来源问题保留", async (state) => {
    const test = await prepared(); const spec = buildProjectGeometrySpec(test.head, crypto.randomUUID());
    let head = test.head;
    if (state === "relativeElevation") {
      head = (await commitDimensionReviews({ head, candidate: test.candidate, drafts: [{ rowIndex: 0, quantityKind: "relativeElevation", disposition: "adopt", name: "总宽", valueMm: "100", checked: true, reason: "内部类型修正测试" }], actorId: localActorId(), commands: projectCommands, repository: projectRepository })).head!;
    } else head.snapshot.candidates.find((row) => row.id === test.candidate.id)!.reviewStatus = state as "rejected" | "superseded";
    head.snapshot.geometrySpecs.push(spec);
    expect(geometryGenerationGate(head).ready).toBe(false);
    expect(() => buildProjectGeometrySpec(head, crypto.randomUUID())).toThrow("DIMENSION_BINDING_INVALID");
    const source = objectSourceModel(head.snapshot, spec.objects[0]!);
    expect(source.dimensions[0]!.dimension).toBeNull();
    expect(source.dimensions[0]!.selection).toEqual({ candidateId: test.candidate.id, rowIndex: 0 });
    expect(source.issues.some((issue) => issue.subjectRefs.includes(test.candidate.id))).toBe(true);
    expect(source.modelLengths[0]!.value).toBe("6000");
  });
  it("只有可读图像时不要求文字，读取重试成功后关闭旧失败问题", async () => {
    const test = await prepared();
    const failed = await retryImage(await imageHead(test.head), "failed");
    expect(failed.snapshot.issues.some((issue) => issue.status === "open" && issue.sourceRef === "rule:parse-failure-review")).toBe(true);
    const head = await retryImage(failed, "readable");
    expect(head.snapshot.issues.filter((issue) => issue.status === "open").map((issue) => issue.sourceRef)).not.toContain("rule:parsed-evidence-required");
    expect(head.snapshot.issues.filter((issue) => issue.status === "open").map((issue) => issue.sourceRef)).not.toContain("rule:parse-failure-review");
  });
  it("最新构件输入驳回后不退回更早的已确认参数", async () => {
    const test = await prepared();
    const field = "geometry.component." + test.inputs[0]!.stableKey;
    const prior = test.head.snapshot.facts.find((fact) => fact.field === field)!;
    const snapshot = structuredClone(test.head.snapshot);
    snapshot.facts.push({ ...prior, id: crypto.randomUUID(), reviewStatus: "rejected" });
    const head = { ...test.head, snapshot };
    expect(componentInputs(snapshot)).toHaveLength(1);
    expect(geometryGenerationGate(head).ready).toBe(false);
    expect(() => buildProjectGeometrySpec(head, crypto.randomUUID())).toThrow("FACTS_MISSING");
  });
  it.each(["failed", "unsupported"] as const)("保留派生图时最新读取为 %s，界面和问题规则均认定不可用", async (state) => {
    const test = await prepared(); const snapshot = await imageHead(test.head);
    const evidence = snapshot.snapshot.evidences[0]!;
    const usable = await workflow.evaluate(snapshot, localActorId());
    expect(usable.snapshot.issues.filter((issue) => issue.status === "open").map((issue) => issue.sourceRef)).not.toContain("rule:parsed-evidence-required");
    const head = await retryImage(usable, state);
    expect(evidenceReadability(head.snapshot, evidence.id).state).toBe(state);
    expect(head.snapshot.evidences[0]!.imageDerivative).toBeDefined();
    expect(head.snapshot.issues.filter((issue) => issue.status === "open").map((issue) => issue.sourceRef)).toContain("rule:parsed-evidence-required");
  });
});
