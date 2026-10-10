import "fake-indexeddb/auto";
import { ProjectCommandService, type ProjectHead } from "@gujian/application";
import type { ArtifactRecord, ArtifactRequirementMatrix, CheckRun, DeliveryEvaluation, GeometryRevision, ProjectDrivenGeometrySpec } from "@gujian/domain";
import { describe, expect, it, vi } from "vitest";

import { collectDeliveryBlockerDetails, DeliveryService, modelInputsCurrent } from "./delivery-service.js";
import { IndexedDbProjectRepository, LocalAuthorization, openWorkbenchDatabase } from "./indexeddb-project-repository.js";
import { sha256Hex } from "./hash.js";
import { ProjectPackageService } from "./project-package-service.js";

describe("delivery blocker propagation", () => {
  it("传播 open issue、结构化 unknown 和 blocked check，并区分仅正式资格阻断", () => {
    const projectId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const geometrySpecId = crypto.randomUUID();
    const geometryId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const unknownId = crypto.randomUUID();
    const issueId = crypto.randomUUID();
    const checkId = crypto.randomUUID();
    const spec = {
      schemaVersion: "2.0", id: geometrySpecId, projectId, projectRevisionId: revisionId, buildingId: crypto.randomUUID(), inputHash: "1".repeat(64),
      coordinateSystem: { name: "local", axisOrder: "XYZ", upAxis: "Z", lengthUnit: "mm", origin: [0, 0, 0] }, tolerances: { modellingMm: 0.5, interfaceMm: 0.5, tessellationMm: 1 },
      objects: [{ id: objectId, stableKey: "wall", parentId: null, componentType: "wall", displayNameZh: "墙", materialCode: "documented", solid: { kind: "box", sizeX: "1", sizeY: "1", sizeZ: "1", centerMm: [0, 0, 0] }, parameters: [], producer: { producerType: "rule", ruleRunId: crypto.randomUUID() }, factRefs: [], evidenceRefs: [], unknownRefs: [unknownId] }],
      interfaces: [], unknowns: [{ id: unknownId, subjectRef: objectId, reasonCode: "WALL_SECTION_MISSING", description: "墙身构造缺失。", requiredEvidence: ["墙身详图"], affectedRefs: [objectId], evidenceRefs: [], blocksProxyOutcome: true, blocksFormalEligibility: true }],
      createdAt: "2026-08-14T00:00:00Z",
    } as ProjectDrivenGeometrySpec;
    const head = {
      projectId, revisionId, auditEventId: crypto.randomUUID(),
      snapshot: {
        taskDefinitions: [], geometryRevisions: [{ id: geometryId, geometrySpecId }],
        geometrySpecs: [spec],
        reviewSignoffs: [],
        issues: [{ id: issueId, projectId, issueType: "ruleConflict", subjectRefs: [objectId], description: "开口定位冲突。", sourceRef: "rule:opening", status: "open", impactRefs: [geometryId], blocksProxyOutcome: true, blocksFormalEligibility: true, producer: { producerType: "rule", ruleRunId: crypto.randomUUID() }, createdAt: "2026-08-14T00:00:00Z", resolvedAt: null }],
      },
    } as unknown as ProjectHead;
    const geometry = { id: geometryId, geometrySpecId } as GeometryRevision;
    const checkRun = {
      id: checkId,
      results: [
        { code: "GEOMETRY_SOURCE_CLOSURE_FAILED", outcome: "blocked", message: "来源闭包失败。", sourceRefs: [geometryId] },
        { code: "PROFESSIONAL_REVIEW_REQUIRED", outcome: "blocked", message: "需专业复核。", sourceRefs: [geometryId] },
      ],
    } as CheckRun;
    const artifact = { id: crypto.randomUUID(), fileName: "drawing.dxf", blockers: ["FORMAL_SIGNOFF_UNAVAILABLE"] } as ArtifactRecord;
    const details = collectDeliveryBlockerDetails(head, geometry, [artifact], checkRun);
    expect(details.some((item) => item.sourceType === "unknown" && item.blocksProxyOutcome)).toBe(true);
    expect(details.some((item) => item.sourceType === "issue" && item.blocksProxyOutcome)).toBe(true);
    expect(details.some((item) => item.code === "CHECK_BLOCKED:GEOMETRY_SOURCE_CLOSURE_FAILED" && item.blocksProxyOutcome)).toBe(true);
    expect(details.find((item) => item.code === "CHECK_BLOCKED:PROFESSIONAL_REVIEW_REQUIRED")?.blocksProxyOutcome).toBe(false);
    expect(details.find((item) => item.code === "FORMAL_SIGNOFF_UNAVAILABLE")?.blocksProxyOutcome).toBe(false);
  });

  // 实施单元 09：正式环境的复核签发记录解除未经复核与本机不能签发两条阻断，
  // 检查记录里对应的阻断结果与成果上的阻断码一并解除；L1 只在记录认定时解除。
  it("有复核签发记录时，正式资格阻断随记录解除，其余阻断照旧", () => {
    const projectId = crypto.randomUUID();
    const geometryId = crypto.randomUUID();
    const geometrySpecId = crypto.randomUUID();
    const issueId = crypto.randomUUID();
    const base = {
      projectId, revisionId: crypto.randomUUID(), auditEventId: crypto.randomUUID(),
      snapshot: {
        taskDefinitions: [], geometryRevisions: [{ id: geometryId, geometrySpecId }],
        geometrySpecs: [{ id: geometrySpecId, unknowns: [] }],
        issues: [{ id: issueId, issueType: "ruleConflict", description: "尺寸冲突。", status: "open", blocksProxyOutcome: false }],
        reviewSignoffs: [] as unknown[],
      },
    };
    const geometry = { id: geometryId, geometrySpecId } as GeometryRevision;
    const checkRun = {
      id: crypto.randomUUID(),
      results: [{ code: "PROFESSIONAL_REVIEW_REQUIRED", outcome: "blocked", message: "需专业复核。", sourceRefs: [geometryId] }],
    } as CheckRun;
    const artifact = { id: crypto.randomUUID(), fileName: "drawing.dxf", blockers: ["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE"] } as ArtifactRecord;

    const before = collectDeliveryBlockerDetails(base as unknown as ProjectHead, geometry, [artifact], checkRun);
    expect(before.map((item) => item.code)).toEqual(expect.arrayContaining(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", "L1_ELIGIBILITY_FALSE", "CHECK_BLOCKED:PROFESSIONAL_REVIEW_REQUIRED"]));

    const signed = {
      ...base,
      snapshot: {
        ...base.snapshot,
        reviewSignoffs: [{
          id: crypto.randomUUID(), projectId, projectRevisionId: base.revisionId, deliveryDraftId: crypto.randomUUID(), geometryRevisionId: geometryId,
          reviewerRole: "professionalReviewer", reviewerActorId: crypto.randomUUID(), reviewedAt: "2026-08-20T00:00:00Z", signedAt: "2026-08-20T00:00:00Z",
          issuingEnvironment: "formal", l1Eligible: false, statementZh: "复核通过。",
        }],
      },
    };
    const after = collectDeliveryBlockerDetails(signed as unknown as ProjectHead, geometry, [artifact], checkRun);
    const codes = after.map((item) => item.code);
    expect(codes).not.toContain("PROFESSIONAL_REVIEW_REQUIRED");
    expect(codes).not.toContain("FORMAL_SIGNOFF_UNAVAILABLE");
    expect(codes).not.toContain("CHECK_BLOCKED:PROFESSIONAL_REVIEW_REQUIRED");
    // L1 未认定，仍在；只阻断正式资格的问题随签发视为已复核接受，不再是阻断
    expect(codes).toContain("L1_ELIGIBILITY_FALSE");
    expect(after.some((item) => item.sourceType === "issue")).toBe(false);

    // 阻断代理成果本身的硬错误不受签发影响
    const hard = { ...signed, snapshot: { ...signed.snapshot, issues: [{ id: issueId, issueType: "ruleConflict", description: "尺寸冲突。", status: "open", blocksProxyOutcome: true }] } };
    expect(collectDeliveryBlockerDetails(hard as unknown as ProjectHead, geometry, [artifact], checkRun).some((item) => item.sourceType === "issue")).toBe(true);

    const l1 = { ...signed, snapshot: { ...signed.snapshot, reviewSignoffs: [{ ...(signed.snapshot.reviewSignoffs[0] as Record<string, unknown>), l1Eligible: true }] } };
    expect(collectDeliveryBlockerDetails(l1 as unknown as ProjectHead, geometry, [artifact], checkRun).map((item) => item.code)).not.toContain("L1_ELIGIBILITY_FALSE");
  });
});

function unitFixture(taskUnit: "mm" | "cm" | "m", modelUnit?: "mm" | "cm" | "m", drawingUnit?: "mm" | "cm" | "m") {
  const projectId = crypto.randomUUID(); const revisionId = crypto.randomUUID(); const geometryId = crypto.randomUUID(); const specId = crypto.randomUUID();
  const geometry = { id: geometryId, projectId, projectRevisionId: revisionId, geometrySpecId: specId, assets: [{ kind: "ifc", assetId: crypto.randomUUID(), sha256: "1".repeat(64), mimeType: "application/x-step", byteLength: 10 }] } as GeometryRevision;
  const matrix = { id: crypto.randomUUID(), geometryRevisionId: geometryId, ...(drawingUnit ? { outputUnit: drawingUnit } : {}) } as ArtifactRequirementMatrix;
  const head = { projectId, revisionId, auditEventId: crypto.randomUUID(), snapshot: {
    taskDefinitions: [{ confirmedAt: "2026-10-01T00:00:00Z", productionSetup: { outputUnit: taskUnit } }],
    geometryRevisions: [geometry], geometrySpecs: [{ id: specId, unknowns: [], ...(modelUnit ? { outputUnit: modelUnit } : {}) }], issues: [],
    reviewSignoffs: [{ id: crypto.randomUUID(), geometryRevisionId: geometryId, l1Eligible: true }],
  } } as unknown as ProjectHead;
  const ifc = { id: crypto.randomUUID(), projectId, geometryRevisionId: geometryId, requirementMatrixId: null, kind: "ifc", fileName: "model.ifc", ...geometry.assets[0], blockers: ["PROFESSIONAL_REVIEW_REQUIRED"] } as ArtifactRecord;
  const drawing = { id: crypto.randomUUID(), geometryRevisionId: geometryId, requirementMatrixId: matrix.id, kind: "dxf", fileName: "drawing.dxf", blockers: ["PROFESSIONAL_REVIEW_REQUIRED"] } as ArtifactRecord;
  const checkRun = { id: crypto.randomUUID(), artifactRefs: [drawing.id], results: [] } as unknown as CheckRun;
  return { head, geometry, matrix, ifc, drawing, checkRun };
}

describe("delivery output units", () => {
  it("单位变更后旧签发不能解除旧模型的单位阻断，新单位图纸仍单独适用", () => {
    const fixture = unitFixture("m", "mm", "m");
    const details = collectDeliveryBlockerDetails(fixture.head, fixture.geometry, [fixture.ifc, fixture.drawing], fixture.checkRun, [fixture.matrix]);
    expect(details.filter((item) => item.code === "OUTPUT_UNIT_MISMATCH")).toEqual([expect.objectContaining({ sourceRef: fixture.ifc.id, blocksProxyOutcome: true })]);
    expect(details.map((item) => item.code)).toEqual(expect.arrayContaining(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", "L1_ELIGIBILITY_FALSE"]));
    const drawingOnly = collectDeliveryBlockerDetails(fixture.head, fixture.geometry, [fixture.drawing], fixture.checkRun, [fixture.matrix]);
    expect(drawingOnly.some((item) => item.code === "OUTPUT_UNIT_MISMATCH")).toBe(false);
  });

  it("按成果引用的矩阵判断，旧图纸不会被最新矩阵或签发覆盖", () => {
    const fixture = unitFixture("cm", "cm", "mm");
    const newest = { ...fixture.matrix, id: crypto.randomUUID(), outputUnit: "cm" as const };
    const details = collectDeliveryBlockerDetails(fixture.head, fixture.geometry, [fixture.ifc, fixture.drawing], fixture.checkRun, [fixture.matrix, newest]);
    expect(details.filter((item) => item.code === "OUTPUT_UNIT_MISMATCH")).toEqual([expect.objectContaining({ sourceRef: fixture.drawing.id, blocksProxyOutcome: true })]);
    expect(details.some((item) => item.code === "FORMAL_SIGNOFF_UNAVAILABLE")).toBe(true);
  });

  it("旧单位模型关联新单位矩阵时仍按模型规格保留硬阻断", () => {
    const fixture = unitFixture("m", "mm", "m");
    const linkedModel = { ...fixture.ifc, requirementMatrixId: fixture.matrix.id };
    const details = collectDeliveryBlockerDetails(fixture.head, fixture.geometry, [linkedModel, fixture.drawing], fixture.checkRun, [fixture.matrix]);
    expect(details.filter((item) => item.code === "OUTPUT_UNIT_MISMATCH")).toEqual([expect.objectContaining({ sourceRef: linkedModel.id, blocksProxyOutcome: true })]);
  });

  it("旧毫米规格和矩阵保持兼容，读取不补写单位", () => {
    const fixture = unitFixture("mm");
    const before = JSON.stringify([fixture.head.snapshot.geometrySpecs, fixture.matrix]);
    const details = collectDeliveryBlockerDetails(fixture.head, fixture.geometry, [fixture.ifc, fixture.drawing], fixture.checkRun, [fixture.matrix]);
    expect(details).toEqual([]);
    expect(JSON.stringify([fixture.head.snapshot.geometrySpecs, fixture.matrix])).toBe(before);
    expect(fixture.head.snapshot.geometrySpecs[0]).not.toHaveProperty("outputUnit");
    expect(fixture.matrix).not.toHaveProperty("outputUnit");
  });

  it("草案包含新单位图纸和已保存旧单位模型时先保存 blocked 评估，再拒绝生成草案", async () => {
    const fixture = unitFixture("m", "mm", "m");
    const evaluations: DeliveryEvaluation[] = [];
    const execute = vi.fn(async (command: { commandType: string; payload: { evaluation?: DeliveryEvaluation } }) => {
      if (command.payload.evaluation) evaluations.push(command.payload.evaluation);
    });
    const stageAssets = vi.fn();
    const repository = {
      getProjectArtifacts: async () => [fixture.ifc], getProjectHead: async () => fixture.head,
      getProjectArtifactRequirementMatrices: async () => [fixture.matrix], stageAssets,
    } as unknown as IndexedDbProjectRepository;
    const service = new DeliveryService({ repository, commands: { execute } as unknown as ProjectCommandService });
    await expect(service.createProxyDraft(fixture.head, crypto.randomUUID(), fixture.geometry, [fixture.drawing], fixture.checkRun)).rejects.toThrow(/DELIVERY_PROXY_BLOCKED:.*OUTPUT_UNIT_MISMATCH/);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({ outcome: "blocked", artifactRefs: expect.arrayContaining([fixture.ifc.id, fixture.drawing.id]) });
    expect(evaluations[0]!.blockerDetails).toEqual(expect.arrayContaining([expect.objectContaining({ sourceRef: fixture.ifc.id, code: "OUTPUT_UNIT_MISMATCH", blocksProxyOutcome: true })]));
    expect(execute.mock.calls.map(([command]) => command.commandType)).toEqual(["EvaluateDelivery"]);
    expect(stageAssets).not.toHaveBeenCalled();
  });
});

const encode = (text: string) => new TextEncoder().encode(text);
function testGlb() {
  const payload = JSON.stringify({ asset: { version: "2.0" }, meshes: [{ primitives: [] }] });
  const chunk = encode(payload.padEnd(Math.ceil(payload.length / 4) * 4, " "));
  const bytes = new Uint8Array(20 + chunk.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, chunk.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(chunk, 20);
  return bytes;
}
async function modelFixture(fault = "", unit: "mm" | "cm" | "m" = "m") {
  const database = await openWorkbenchDatabase(`unit27-model-${crypto.randomUUID()}`);
  const repository = new IndexedDbProjectRepository(Promise.resolve(database));
  const commands = new ProjectCommandService({ repository, authorization: new LocalAuthorization() });
  const service = new DeliveryService({ repository, commands });
  const actorId = crypto.randomUUID(), projectId = crypto.randomUUID(), buildingId = crypto.randomUUID(), at = "2026-10-03T00:00:00Z";
  const task = { id: crypto.randomUUID(), name: "内部模型文件检查", scope: ["局部模型"], deliverables: ["模型"], regulationRefs: [], responsibilities: [{ role: "projectLead" as const, actorId }], automationPolicyRef: null,
    productionSetup: { buildingId, purpose: "existingSurvey" as const, outputUnit: unit, targets: fault === "targets" ? ["model", "floorPlan"] as const : ["model"] as const, projectGroup: null }, confirmedAt: at };
  await commands.execute({ commandType: "CreateProject", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: null, issuedAt: at,
    payload: { project: { id: projectId, name: "内部文件检查", locationText: null, status: "active", createdAt: at }, building: { id: buildingId, projectId, name: "内部测试建筑", periodText: null, addressText: null, status: "existing" }, taskDefinition: task } });
  let head = (await repository.getProjectHead(projectId))!;
  const factCommandId = crypto.randomUUID();
  const candidateId = crypto.randomUUID(), runId = crypto.randomUUID(), evidenceRef = crypto.randomUUID();
  const candidateSource = fault === "source-dimension" || fault === "source-component";
  const issueId = crypto.randomUUID();
  if (candidateSource) {
    const bytes = encode("内部候选来源资料，非真实测绘记录。"), session = crypto.randomUUID();
    const asset = { id: crypto.randomUUID(), projectId, fileName: "内部候选来源.txt", mimeType: "text/plain", byteLength: bytes.length, sha256: sha256Hex(bytes), contentStatus: "available" as const, createdAt: at };
    await repository.stageAssets(session, [asset], new Map([[asset.id, new Blob([bytes as BlobPart], { type: asset.mimeType })]]));
    await commands.execute({ commandType: "ImportEvidence", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at,
      payload: { evidence: { id: evidenceRef, projectId, assetId: asset.id, evidenceType: "document", title: asset.fileName, rightsDeclaration: null, intendedUse: "内部验证", recordedAt: null, relatedEntityRefs: [], dataStatus: "available" }, asset,
        parseRecord: { id: crypto.randomUUID(), projectId, assetId: asset.id, evidenceId: evidenceRef, parser: "内部测试", parserVersion: "1", status: "parsed", readability: "readable", readableAs: "text", extractedText: new TextDecoder().decode(bytes), warnings: [], createdAt: at }, stagingSessionId: session } });
    head = (await repository.getProjectHead(projectId))!;
    const taskType = fault === "source-component" ? "component-recognition" : "measurement-transcription";
    await commands.execute({ commandType: "CommitModelRunResult", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at,
      payload: { run: { id: runId, projectId, inputRevisionId: head.revisionId, inputHash: "a".repeat(64), provider: "internal-test", model: "fixture-not-real-model", taskType, status: "succeeded", evidenceRefs: [evidenceRef], usage: null, outputHash: "b".repeat(64), startedAt: at, completedAt: at,
        events: (["queued", "succeeded"] as const).map((eventType, sequence) => ({ id: crypto.randomUUID(), runId, sequence, eventType, attempt: 1, detail: "内部验证，未联网", occurredAt: at })) },
        candidate: { id: candidateId, projectId, runId, inputRevisionId: head.revisionId, taskType, contentText: "内部候选来源验证", producer: { producerType: "model", runId }, evidenceRefs: [evidenceRef], reviewStatus: "unreviewed", createdAt: at,
          structured: fault === "source-component" ? { kind: "componentRecognition", summary: "内部墙体", components: [{ nameZh: "内部墙体", categoryZh: "墙体", evidenceRef, region: { x: .1, y: .2, width: .3, height: .4 }, certainty: "certain", noteZh: null }], missingInformation: [] }
            : { kind: "measurementTranscription", summary: "内部总宽", dimensions: [{ partZh: "总宽", quantityKind: "length", valueText: "6100.5", valueMm: "6100.5", evidenceRef, locationZh: "内部测试第1行", certainty: "certain", noteZh: null }], missingInformation: [] } } } });
    head = (await repository.getProjectHead(projectId))!;
    const ruleId = crypto.randomUUID();
    await commands.execute({ commandType: "CommitRuleEvaluation", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at,
      payload: { ruleRun: { id: ruleId, projectId, inputRevisionId: head.revisionId, ruleSetVersion: "internal-source-review", status: "completed", producer: { producerType: "rule", ruleRunId: ruleId }, startedAt: at, completedAt: at,
        results: [{ ruleId: "candidate-review", outcome: "issue", inputRefs: [candidateId], issueRefs: [issueId], message: "候选来源待核对" }] },
        issues: [{ id: issueId, projectId, issueType: "professionalUncertainty", subjectRefs: [candidateId], description: "内部候选整体核对", sourceRef: "rule:candidate-review", status: "open", impactRefs: [], blocksProxyOutcome: false, blocksFormalEligibility: true, producer: { producerType: "rule", ruleRunId: ruleId }, createdAt: at, resolvedAt: null }] } });
    head = (await repository.getProjectHead(projectId))!;
  }
  const facts = ["geometry.component.wall", "documentedDimension.candidate." + candidateId + ".0"].map((field, index) => ({ id: crypto.randomUUID(), subjectRef: buildingId, field,
    value: index ? { kind: fault === "source-dimension" ? "dimensionCandidateReview" : "documentedDimension", disposition: "adopt", name: "总宽", quantityKind: "length", value: 6100.5, unit: "mm", methodZh: "资料转写", sourceKind: "document-transcription", candidateId, runId, rowIndex: 0,
      original: { partZh: "总宽", valueText: "6100.5", valueMm: "6100.5", evidenceRef, locationZh: "内部测试第1行", certainty: "certain", noteZh: null }, reason: "", corrected: false }
      : { stableKey: fault === "source-component" ? `candidate:${candidateId}:0` : "wall", ...(fault === "source-component" ? { candidateSource: { candidateId, rowIndex: 0 } } : {}), displayNameZh: "内部墙体", componentType: "wall", materialCode: "brick", parentStableKey: null, sourceLocation: "内部测试", evidenceRefs: candidateSource ? [evidenceRef] : [],
        solid: { kind: "box", sizeX: "6100.5", sizeY: "240", sizeZ: "3000", centerMm: [0, 0, 1500] }, positionBasis: "human", parameters: [], unknowns: [] },
    reviewStatus: "confirmed" as const, dataStatus: "available" as const, evidenceRefs: candidateSource ? [evidenceRef] : [],
    producer: { producerType: "human" as const, actorId, actionRef: { commandId: factCommandId } }, acceptanceRef: { type: "command" as const, id: factCommandId } }));
  await commands.execute({ commandType: "CommitFacts", commandId: factCommandId, projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at, payload: { facts } });
  head = (await repository.getProjectHead(projectId))!;
  const spec: ProjectDrivenGeometrySpec = { schemaVersion: "2.0", id: crypto.randomUUID(), projectId, projectRevisionId: head.revisionId, buildingId, inputHash: "1".repeat(64), outputUnit: fault === "spec-unit" ? "mm" : unit,
    coordinateSystem: { name: "内部坐标", axisOrder: "XYZ", upAxis: "Z", lengthUnit: "mm", origin: [0, 0, 0] }, tolerances: { modellingMm: .5, interfaceMm: .5, tessellationMm: 1 },
    objects: [{ id: crypto.randomUUID(), stableKey: fault === "source-component" ? `candidate:${candidateId}:0` : "wall", parentId: null, componentType: "wall", displayNameZh: "内部墙体", materialCode: "brick", solid: { kind: "box", sizeX: "6100.5", sizeY: "240", sizeZ: "3000", centerMm: [0, 0, 1500] }, parameters: [], producer: { producerType: "demo", fixtureId: "unit27-file-check" }, factRefs: facts.map((fact) => fact.id), evidenceRefs: candidateSource ? [evidenceRef] : [], unknownRefs: [] }], interfaces: [], unknowns: [], createdAt: at };
  const geometryId = crypto.randomUUID();
  const prefix = { mm: ".MILLI.", cm: ".CENTI.", m: "$" }[fault === "ifc-unit" ? "mm" : unit];
  const bytesByKind = new Map<GeometryRevision["assets"][number]["kind"], Uint8Array>([
    ["ifc", encode(`ISO-10303-21;\nDATA;\n#1=IFCSIUNIT(*,.LENGTHUNIT.,${prefix},.METRE.);\n#2=IFCUNITASSIGNMENT((#1));\nENDSEC;\nEND-ISO-10303-21;`)],
    ["glb", testGlb()], ["brepBundle", encode("内部 BRep 文件，仅验证资产对应关系")], ["sourceMap", encode(JSON.stringify({ objectId: spec.objects[0]!.id, factRefs: spec.objects[0]!.factRefs }) + "\n")],
    ["report", encode(JSON.stringify({ schemaVersion: "1.0", geometryRevisionId: geometryId, geometrySignature: "4".repeat(64) }))], ["preview", encode("内部预览文件，仅验证资产对应关系")],
  ]);
  if (fault === "glb-format") bytesByKind.get("glb")![0] = 0;
  const fileNames = { ifc: "model.ifc", glb: "model.glb", brepBundle: "model-brep.zip", sourceMap: "source-map.ndjson", report: "geometry-report.json", preview: "preview.png", manifest: "manifest.json" };
  const mimeTypes = { ifc: "application/x-step", glb: "model/gltf-binary", brepBundle: "application/zip", sourceMap: "application/x-ndjson", report: "application/json", preview: "image/png", manifest: "application/json" };
  const files = [...bytesByKind].map(([kind, bytes]) => ({ kind, fileName: fileNames[kind], mimeType: mimeTypes[kind], byteLength: bytes.length, sha256: sha256Hex(bytes) }));
  const manifest = { schemaVersion: fault === "manifest-version" ? "2.0" : "1.0", projectId, projectRevisionId: spec.projectRevisionId, geometrySpecId: spec.id,
    geometryRevisionId: fault === "manifest-geometry" ? crypto.randomUUID() : geometryId, inputHash: fault === "manifest-input" ? "9".repeat(64) : spec.inputHash,
    entityClosureHash: "2".repeat(64), interfaceClosureHash: "3".repeat(64), geometrySignature: "4".repeat(64), assets: files };
  if (fault === "manifest-file") manifest.assets[0]!.fileName = "other.ifc";
  if (fault === "manifest-missing") manifest.assets.pop();
  bytesByKind.set("manifest", encode(JSON.stringify(manifest)));
  const assets = [...bytesByKind].map(([kind, bytes]) => ({ id: crypto.randomUUID(), projectId, fileName: fileNames[kind], mimeType: mimeTypes[kind], byteLength: bytes.length, sha256: sha256Hex(bytes), contentStatus: "available" as const, createdAt: at, kind }));
  const geometry: GeometryRevision = { id: geometryId, projectId, projectRevisionId: spec.projectRevisionId, geometrySpecId: spec.id, inputHash: spec.inputHash, entityClosureHash: "2".repeat(64), interfaceClosureHash: "3".repeat(64), geometrySignature: "4".repeat(64),
    assets: assets.map(({ id, kind, sha256, byteLength, mimeType }) => ({ assetId: id, kind, sha256, byteLength, mimeType })), status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, blockers: ["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE"], createdAt: at };
  const job = { id: crypto.randomUUID(), projectId, inputRevisionId: head.revisionId, geometrySpecId: spec.id, inputHash: spec.inputHash, idempotencyKey: crypto.randomUUID(), status: "queued" as const, events: [], outputManifestHash: null, startedAt: at, completedAt: null };
  await commands.execute({ commandType: "StartCadJob", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at, payload: { job } });
  head = (await repository.getProjectHead(projectId))!;
  const events = (["queued", "succeeded"] as const).map((eventType, sequence) => ({ id: crypto.randomUUID(), jobId: job.id, sequence, eventType, detail: null, occurredAt: at, previousHash: sequence ? "5".repeat(64) : null, eventHash: (sequence ? "6" : "5").repeat(64) }));
  await commands.execute({ commandType: "SyncCadJobEvents", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at,
    payload: { job: { ...job, status: "succeeded", outputManifestHash: assets.find((asset) => asset.kind === "manifest")!.sha256, completedAt: at, events } } });
  head = (await repository.getProjectHead(projectId))!;
  const session = crypto.randomUUID();
  const records = assets.map(({ kind: _kind, ...record }) => record);
  await repository.stageAssets(session, records, new Map(assets.map((asset) => [asset.id, new Blob([bytesByKind.get(asset.kind)!.slice().buffer as ArrayBuffer], { type: asset.mimeType })])));
  await commands.execute({ commandType: "CommitGeometryRevision", commandId: crypto.randomUUID(), projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: at, payload: { cadJobId: job.id, geometrySpec: spec, geometryRevision: geometry, assets: records, stagingSessionId: session } });
  head = (await repository.getProjectHead(projectId))!;
  async function corrupt(kind: GeometryRevision["assets"][number]["kind"], mode: "missing" | "tamper" | "length" | "metadata") {
    const asset = assets.find((item) => item.kind === kind)!;
    const stored = await repository.getAsset(asset.id);
    const bytes = new Uint8Array(await stored.content.arrayBuffer());
    if (mode === "tamper") bytes[0] = bytes[0]! ^ 1;
    const transaction = database.transaction("assets", "readwrite");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
      if (mode === "missing") transaction.objectStore("assets").delete(asset.id);
      else transaction.objectStore("assets").put({ id: asset.id, projectId, record: mode === "metadata" ? { ...stored.record, byteLength: stored.record.byteLength + 1 } : stored.record,
        content: new Blob([mode === "length" ? bytes.slice(0, -1).buffer as ArrayBuffer : bytes.buffer as ArrayBuffer], { type: asset.mimeType }) });
    });
  }
  return { head, actorId, geometry, repository, commands, service, database, corrupt, facts, bytesByKind, candidateId, issueId };
}

describe("仅模型实际文件检查", () => {
  it.each(["source-dimension", "source-component"])("实际整体驳回 %s 来源后事实ID不变，旧模型检查和草案均失效", async (source) => {
    const test = await modelFixture(source);
    try {
      expect(modelInputsCurrent(test.head, test.geometry)).toBe(true);
      const result = await test.service.checkModelFiles(test.head, test.actorId, test.geometry);
      const commandId = crypto.randomUUID();
      await test.commands.execute({ commandType: "DecideCandidate", commandId, projectId: test.head.projectId, actorId: test.actorId, expectedRevisionId: result.head.revisionId, issuedAt: "2026-10-03T01:00:00Z",
        payload: { candidateId: test.candidateId, decision: { id: crypto.randomUUID(), projectId: test.head.projectId, issueId: test.issueId, actorId: test.actorId, commandId, outcome: "rejected", reason: "按整体来源重新核对后驳回", impactRefs: [test.geometry.id], decidedAt: "2026-10-03T01:00:00Z" } } });
      const head = (await test.repository.getProjectHead(test.head.projectId))!;
      expect(head.snapshot.facts).toEqual(result.head.snapshot.facts);
      expect(head.snapshot.candidates.find((item) => item.id === test.candidateId)!.reviewStatus).toBe("rejected");
      expect(head.snapshot.geometryRevisions[0]!.assets).toEqual(test.geometry.assets);
      expect(modelInputsCurrent(head, test.geometry)).toBe(false);
      await expect(test.service.checkModelFiles(head, test.actorId, test.geometry)).rejects.toThrow("MODEL_CHECK_INPUTS_STALE");
      await expect(test.service.createProxyDraft(head, test.actorId, test.geometry, result.artifacts, result.checkRun)).rejects.toThrow("MODEL_CHECK_INPUTS_STALE");
      expect((await test.repository.getProjectHead(head.projectId))!.revisionId).toBe(head.revisionId);
      expect((await test.repository.getProjectCheckRuns(head.projectId)).map((check) => check.id)).toEqual([result.checkRun.id]);
      expect(await test.repository.getProjectDeliveries(head.projectId)).toEqual([]);
    } finally { test.database.close(); }
  });
  it.each(["mm", "cm", "m"] as const)("%s 模型保存独立非空报告，待签发草案实际包恢复保留对应成果", async (unit) => {
    const test = await modelFixture("", unit);
    try {
      const result = await test.service.checkModelFiles(test.head, test.actorId, test.geometry);
      expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(expect.arrayContaining(["ifc", "glb", "geometryManifest", "geometrySourceMap", "geometryReport", "checkReport"]));
      expect(result.checkRun).toMatchObject({ qualification: "generated-not-qualified", l1Eligible: false, formalEligibility: false, results: [expect.objectContaining({ code: "MODEL_OUTPUT_HASH_CLOSURE", outcome: "passed" }), expect.objectContaining({ code: "PROFESSIONAL_REVIEW_REQUIRED", outcome: "blocked" })] });
      const saved = await test.repository.getAsset(result.checkRun.reportAssetId), bytes = new Uint8Array(await saved.content.arrayBuffer());
      const report = JSON.parse(new TextDecoder().decode(bytes));
      expect(sha256Hex(bytes)).toBe(result.checkRun.reportHash);
      expect(report).toMatchObject({ scope: "model-files", outputUnit: unit, glbLengthUnit: "m", geometryRevisionId: test.geometry.id, checkRunId: result.checkRun.id });
      expect(report.files).toHaveLength(7); expect(report.files[0].byteLength).toBe(test.bytesByKind.get("ifc")!.length);
      expect(report.files[0].sha256).toBe(sha256Hex(test.bytesByKind.get("ifc")!));
      expect(result.checkRun.artifactRefs).toEqual(result.artifacts.map((artifact) => artifact.id));
      expect((await test.repository.getProjectCheckRuns(test.head.projectId)).map((check) => check.id)).toContain(result.checkRun.id);
      const draft = await test.service.createProxyDraft(result.head, test.actorId, test.geometry, result.artifacts, result.checkRun);
      expect(draft.draft).toMatchObject({ status: "proxy-unissued", l1Eligible: false, formalEligibility: false, signatureStatus: "unsigned" });
      const packageBytes = await new ProjectPackageService(test.repository).exportZip(test.head.projectId);
      const restoredDatabase = await openWorkbenchDatabase(`unit27-restore-${crypto.randomUUID()}`);
      try {
        const restoredRepository = new IndexedDbProjectRepository(Promise.resolve(restoredDatabase));
        const restoredId = await new ProjectPackageService(restoredRepository).import(packageBytes, "内部模型检查.zip", test.actorId);
        expect((await restoredRepository.getProjectCheckRuns(restoredId))[0]!.reportHash).toBe(result.checkRun.reportHash);
        expect((await restoredRepository.getProjectDeliveries(restoredId))[0]!.artifactRefs).toEqual(draft.draft.artifactRefs);
        expect(new Uint8Array(await (await restoredRepository.getAsset(result.checkRun.reportAssetId)).content.arrayBuffer())).toEqual(bytes);
      } finally { restoredDatabase.close(); }
    } finally { test.database.close(); }
  });
  it.each(["missing", "tamper", "length", "metadata"] as const)("实际资产 %s 不能新增通过检查，原成功记录不会充作本次成功", async (mode) => {
    const test = await modelFixture();
    try {
      const before = await test.service.checkModelFiles(test.head, test.actorId, test.geometry);
      await test.corrupt("ifc", mode);
      await expect(test.service.checkModelFiles(before.head, test.actorId, test.geometry)).rejects.toThrow(mode === "missing" ? "MODEL_CHECK_FILES_MISSING" : "MODEL_CHECK_ASSET_MISMATCH");
      expect((await test.repository.getProjectCheckRuns(test.head.projectId)).map((check) => check.id)).toEqual([before.checkRun.id]);
      expect((await test.repository.getProjectHead(test.head.projectId))!.revisionId).toBe(before.head.revisionId);
    } finally { test.database.close(); }
  });
  it.each(["manifest-version", "manifest-geometry", "manifest-input", "manifest-file", "manifest-missing", "spec-unit", "ifc-unit", "glb-format", "targets"])("%s 在写通过记录前拒绝，全部文件哈希有效仍核对实际内容", async (fault) => {
    const test = await modelFixture(fault);
    try {
      const code = fault.startsWith("manifest") ? "MODEL_CHECK_MANIFEST_MISMATCH" : fault.includes("unit") ? "MODEL_CHECK_OUTPUT_UNIT_MISMATCH" : fault === "targets" ? "MODEL_CHECK_TARGETS_INVALID" : "MODEL_CHECK_FILE_INVALID";
      await expect(test.service.checkModelFiles(test.head, test.actorId, test.geometry)).rejects.toThrow(code);
      expect(await test.repository.getProjectCheckRuns(test.head.projectId)).toEqual([]);
      expect(await test.repository.getProjectArtifacts(test.head.projectId)).toEqual([]);
      expect((await test.repository.getProjectHead(test.head.projectId))!.revisionId).toBe(test.head.revisionId);
    } finally { test.database.close(); }
  });
  it.each([0, 1])("实际保存构件或采用尺寸新事实 %s 后未生成，拒绝旧文件检查和草案", async (index) => {
    const test = await modelFixture();
    try {
      const checked = await test.service.checkModelFiles(test.head, test.actorId, test.geometry);
      const commandId = crypto.randomUUID(), fact = test.facts[index]!;
      await test.commands.execute({ commandType: "CommitFacts", commandId, projectId: test.head.projectId, actorId: test.actorId, expectedRevisionId: checked.head.revisionId, issuedAt: "2026-10-03T01:00:00Z",
        payload: { facts: [{ ...fact, id: crypto.randomUUID(), value: index ? { ...fact.value, value: 6200 } : { ...fact.value, solid: { kind: "box", sizeX: "6200", sizeY: "240", sizeZ: "3000", centerMm: [0, 0, 1500] } }, producer: { producerType: "human", actorId: test.actorId, actionRef: { commandId } }, acceptanceRef: { type: "command", id: commandId } }] } });
      const head = (await test.repository.getProjectHead(test.head.projectId))!;
      expect(modelInputsCurrent(head, test.geometry)).toBe(false);
      await expect(test.service.checkModelFiles(head, test.actorId, test.geometry)).rejects.toThrow("MODEL_CHECK_INPUTS_STALE");
      await expect(test.service.createProxyDraft(head, test.actorId, test.geometry, checked.artifacts, checked.checkRun)).rejects.toThrow("MODEL_CHECK_INPUTS_STALE");
      expect(await test.repository.getProjectDeliveries(test.head.projectId)).toEqual([]);
      expect(await test.repository.getProjectCheckRuns(test.head.projectId)).toHaveLength(1);
    } finally { test.database.close(); }
  });
  it("空检查、缺GLB或任务追加图纸目标不放行模型草案", async () => {
    const test = await modelFixture();
    try {
      const result = await test.service.checkModelFiles(test.head, test.actorId, test.geometry);
      await expect(test.service.createProxyDraft(result.head, test.actorId, test.geometry, result.artifacts, { ...result.checkRun, results: [] })).rejects.toThrow("DELIVERY_TARGET_OUTPUTS_MISSING");
      await expect(test.service.createProxyDraft(result.head, test.actorId, test.geometry, result.artifacts.filter((item) => item.kind !== "glb"), result.checkRun)).rejects.toThrow("DELIVERY_TARGET_OUTPUTS_MISSING");
      const task = result.head.snapshot.taskDefinitions[0]!;
      await test.commands.execute({ commandType: "ReplaceTaskDefinition", commandId: crypto.randomUUID(), projectId: test.head.projectId, actorId: test.actorId, expectedRevisionId: result.head.revisionId, issuedAt: "2026-10-03T01:00:00Z",
        payload: { supersedesTaskDefinitionId: task.id, taskDefinition: { ...task, id: crypto.randomUUID(), productionSetup: { ...task.productionSetup!, targets: ["model", "floorPlan"] } } } });
      const head = (await test.repository.getProjectHead(test.head.projectId))!;
      await expect(test.service.createProxyDraft(head, test.actorId, test.geometry, result.artifacts, result.checkRun)).rejects.toThrow("DELIVERY_TARGET_OUTPUTS_MISSING");
      expect(await test.repository.getProjectDeliveries(test.head.projectId)).toEqual([]);
    } finally { test.database.close(); }
  });
  it("新增或撤销构件使模型待更新，合成来源和无关记录不使模型失效", async () => {
    const test = await modelFixture();
    try {
      const changed = structuredClone(test.head);
      changed.snapshot.facts.push({ ...test.facts[0]!, id: crypto.randomUUID(), field: "geometry.component.another" });
      expect(modelInputsCurrent(changed, test.geometry)).toBe(false);
      changed.snapshot.facts = [...test.head.snapshot.facts, { ...test.facts[0]!, id: crypto.randomUUID(), reviewStatus: "superseded" }];
      expect(modelInputsCurrent(changed, test.geometry)).toBe(false);
      changed.snapshot.facts = [...test.head.snapshot.facts];
      changed.snapshot.geometrySpecs[0]!.objects[0]!.factRefs.push("fact:historical-synthetic");
      expect(modelInputsCurrent(changed, test.geometry)).toBe(true);
      const commandId = crypto.randomUUID();
      await test.commands.execute({ commandType: "CommitFacts", commandId, projectId: test.head.projectId, actorId: test.actorId, expectedRevisionId: test.head.revisionId, issuedAt: "2026-10-03T01:00:00Z",
        payload: { facts: [{ ...test.facts[0]!, id: crypto.randomUUID(), field: "project.note", value: "仅补充项目说明", producer: { producerType: "human", actorId: test.actorId, actionRef: { commandId } }, acceptanceRef: { type: "command", id: commandId } }] } });
      const head = (await test.repository.getProjectHead(test.head.projectId))!;
      expect(head.revisionId).not.toBe(test.head.revisionId);
      expect(modelInputsCurrent(head, test.geometry)).toBe(true);
      await expect(test.service.checkModelFiles(head, test.actorId, test.geometry)).resolves.toHaveProperty("checkRun");
    } finally { test.database.close(); }
  });
  it("过期head、非当前几何与检查后文件篡改均不得建立新的检查或草案", async () => {
    const test = await modelFixture();
    try {
      const result = await test.service.checkModelFiles(test.head, test.actorId, test.geometry);
      await expect(test.service.checkModelFiles(test.head, test.actorId, test.geometry)).rejects.toThrow("MODEL_CHECK_HEAD_STALE");
      await expect(test.service.checkModelFiles(result.head, test.actorId, { ...test.geometry, id: crypto.randomUUID() })).rejects.toThrow("MODEL_CHECK_GEOMETRY_STALE");
      await test.corrupt("ifc", "tamper");
      await expect(test.service.createProxyDraft(result.head, test.actorId, test.geometry, result.artifacts, result.checkRun)).rejects.toThrow("MODEL_CHECK_ASSET_MISMATCH");
      expect(await test.repository.getProjectCheckRuns(test.head.projectId)).toHaveLength(1);
      expect(await test.repository.getProjectDeliveries(test.head.projectId)).toEqual([]);
    } finally { test.database.close(); }
  });
});
