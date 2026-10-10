import type { ArtifactRecord, ArtifactRequirementMatrix, CheckRun, DeliveryEvaluation, GeometryRevision, ProjectDrivenGeometrySpec, ProjectSnapshot } from "@gujian/domain";
import { describe, expect, it } from "vitest";

import { CommandError } from "./errors.js";
import type {
  AuthorizationPort,
  CommandReceipt,
  CommitProjectMutation,
  ProjectHead,
  ProjectRepositoryPort,
  ProjectTransaction,
} from "./ports.js";
import { ProjectCommandService } from "./project-command-service.js";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  building: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  serverActor: "00000000-0000-4000-8000-000000000004",
  createCommand: "00000000-0000-4000-8000-000000000005",
  factCommand: "00000000-0000-4000-8000-000000000006",
  fact: "00000000-0000-4000-8000-000000000007",
  run: "00000000-0000-4000-8000-000000000008",
};

function createProjectCommand(commandId = ids.createCommand) {
  return {
    commandType: "CreateProject",
    commandId,
    projectId: ids.project,
    actorId: ids.actor,
    expectedRevisionId: null,
    issuedAt: "2026-08-11T00:00:00Z",
    payload: {
      project: {
        id: ids.project,
        name: "测试项目",
        status: "active",
        locationText: null,
        createdAt: "2026-08-11T00:00:00Z",
      },
      building: {
        id: ids.building,
        projectId: ids.project,
        name: "测试建筑",
        periodText: null,
        addressText: null,
        status: "existing",
      },
    },
  };
}

function commitFactsCommand(revisionId: string, commandId = ids.factCommand) {
  return {
    commandType: "CommitFacts",
    commandId,
    projectId: ids.project,
    actorId: ids.actor,
    expectedRevisionId: revisionId,
    issuedAt: "2026-08-11T00:01:00Z",
    payload: {
      facts: [{
        id: ids.fact,
        subjectRef: ids.building,
        field: "bayWidth",
        value: { exactValue: "4200", unit: "mm" },
        producer: { producerType: "model", runId: ids.run },
        evidenceRefs: ["evidence:field-note-1"],
        reviewStatus: "unreviewed",
        dataStatus: "available",
      }],
    },
  };
}

class MemoryRepository implements ProjectRepositoryPort {
  head: ProjectHead | null = null;
  receipts = new Map<string, CommandReceipt>();
  artifacts = new Map<string, ArtifactRecord>();
  matrices = new Map<string, ArtifactRequirementMatrix>();
  checks = new Map<string, CheckRun>();
  evaluations = new Map<string, DeliveryEvaluation>();
  commitCount = 0;
  transactionCount = 0;
  failNextCommit = false;
  lastMutation: CommitProjectMutation | null = null;

  async transaction<T>(_projectId: string, operation: (transaction: ProjectTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const startingHead = this.head;
    const startingReceipts = new Map(this.receipts);
    const pending = { head: startingHead, receipts: startingReceipts, artifacts: new Map(this.artifacts), matrices: new Map(this.matrices), checks: new Map(this.checks), evaluations: new Map(this.evaluations) };
    const transaction: ProjectTransaction = {
      getCommandReceipt: async (commandId) => pending.receipts.get(commandId) ?? null,
      getProjectHead: async () => pending.head,
      getCadJob: async () => null,
      getArtifactRequirementMatrix: async (id) => pending.matrices.get(id) ?? null,
      getAssetRecord: async () => null,
      getArtifact: async (id) => pending.artifacts.get(id) ?? null,
      getCheckRun: async (id) => pending.checks.get(id) ?? null,
      getDeliveryEvaluation: async (id) => pending.evaluations.get(id) ?? null,
      commit: async (mutation) => {
        if (this.failNextCommit) {
          this.failNextCommit = false;
          throw new Error("injected commit failure");
        }
        const ordinal = this.commitCount + 1;
        const revisionId = `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
        const auditEventId = `10000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
        const receipt: CommandReceipt = {
          commandId: mutation.command.commandId,
          commandType: mutation.command.commandType,
          projectId: mutation.command.projectId,
          revisionId,
          auditEventId,
          committedAt: mutation.command.issuedAt,
        };
        pending.head = {
          projectId: mutation.command.projectId,
          revisionId,
          auditEventId,
          snapshot: mutation.snapshot,
        };
        pending.receipts.set(mutation.command.commandId, receipt);
        for (const item of mutation.artifactsToPut ?? []) pending.artifacts.set(item.id, item);
        for (const item of mutation.artifactRequirementMatricesToPut ?? []) pending.matrices.set(item.id, item);
        for (const item of mutation.checkRunsToPut ?? []) pending.checks.set(item.id, item);
        for (const item of mutation.deliveryEvaluationsToPut ?? []) pending.evaluations.set(item.id, item);
        this.lastMutation = mutation;
        return receipt;
      },
    };

    const result = await operation(transaction);
    if (pending.head !== startingHead || pending.receipts.size !== startingReceipts.size) {
      this.head = pending.head;
      this.receipts = pending.receipts;
      this.artifacts = pending.artifacts; this.matrices = pending.matrices; this.checks = pending.checks; this.evaluations = pending.evaluations;
      this.commitCount += 1;
    }
    return result;
  }
}

class TestAuthorization implements AuthorizationPort {
  readonly calls: Array<{ actorId: string; projectId: string; commandType: "CreateProject" | "CommitFacts" }> = [];
  reject = false;

  async assertAuthorized(input: { actorId: string; projectId: string; commandType: "CreateProject" | "CommitFacts" }): Promise<void> {
    this.calls.push(input);
    if (this.reject) {
      throw new CommandError("UNAUTHORIZED", "not authorized");
    }
  }
}

function setup() {
  const repository = new MemoryRepository();
  const authorization = new TestAuthorization();
  const service = new ProjectCommandService({ repository, authorization });
  return { authorization, repository, service };
}

describe("ProjectCommandService", () => {
  it("通过唯一事务入口建立初始项目版本", async () => {
    const { repository, service } = setup();
    const receipt = await service.execute(createProjectCommand());

    expect(receipt.revisionId).toBe(repository.head?.revisionId);
    expect(repository.head?.snapshot.schemaVersion).toBe("3.0");
    expect(repository.commitCount).toBe(1);
    expect(repository.lastMutation?.parentRevisionId).toBeNull();
  });

  it("相同 commandId 重试返回原回执且不重复写入", async () => {
    const { repository, service } = setup();
    const first = await service.execute(createProjectCommand());
    const second = await service.execute(createProjectCommand());

    expect(second).toEqual(first);
    expect(repository.commitCount).toBe(1);
  });

  it("版本冲突在提交前失败", async () => {
    const { repository, service } = setup();
    await service.execute(createProjectCommand());

    await expect(service.execute(commitFactsCommand("00000000-0000-4000-8000-999999999999")))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(repository.commitCount).toBe(1);
  });

  it("提交失败不留下项目头或命令回执", async () => {
    const { repository, service } = setup();
    repository.failNextCommit = true;

    await expect(service.execute(createProjectCommand())).rejects.toThrow("injected commit failure");
    expect(repository.head).toBeNull();
    expect(repository.receipts.size).toBe(0);
    expect(repository.commitCount).toBe(0);
  });

  it("服务端权威身份覆盖客户端 actorId", async () => {
    const { authorization, repository, service } = setup();
    await service.execute(createProjectCommand(), { authoritativeActorId: ids.serverActor });

    expect(authorization.calls[0]?.actorId).toBe(ids.serverActor);
    expect(repository.lastMutation?.authoritativeActorId).toBe(ids.serverActor);
  });

  it("未授权命令不会开启仓储事务", async () => {
    const { authorization, repository, service } = setup();
    authorization.reject = true;

    await expect(service.execute(createProjectCommand())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(repository.transactionCount).toBe(0);
  });

  it("新增事实保留模型来源并拒绝重复事实 ID", async () => {
    const { repository, service } = setup();
    const created = await service.execute(createProjectCommand());
    const committed = await service.execute(commitFactsCommand(created.revisionId));

    expect((repository.head?.snapshot as ProjectSnapshot).facts[0]?.producer).toEqual({
      producerType: "model",
      runId: ids.run,
    });
    await expect(service.execute(commitFactsCommand(committed.revisionId, "00000000-0000-4000-8000-000000000009")))
      .rejects.toMatchObject({ code: "COMMAND_INVALID" });
    expect(repository.commitCount).toBe(2);
  });

  // 构件记录的写入与修订此前在应用层一条测试都没有。类别修改与位置调整
  // 采纳后要真改这条记录，改错对象或改到不存在的记录都必须挡住。
  it("构件记录写入后可按 id 修订，修订不存在的记录被拒", async () => {
    const { repository, service } = setup();
    const created = await service.execute(createProjectCommand());
    const entityId = "00000000-0000-4000-8000-00000000000b";
    const entity = (overrides: Record<string, unknown> = {}) => ({
      id: entityId,
      projectId: ids.project,
      buildingId: ids.building,
      parentId: null,
      entityType: "待确认",
      name: "雀替",
      locationText: null,
      origin: "marquee",
      ...overrides,
    });
    const command = (commandId: string, revisionId: string, commandType: string, payloadEntity: unknown) => ({
      commandType,
      commandId,
      projectId: ids.project,
      actorId: ids.actor,
      expectedRevisionId: revisionId,
      issuedAt: "2026-08-20T00:00:00Z",
      payload: { entities: [payloadEntity] },
    });

    const written = await service.execute(command("00000000-0000-4000-8000-00000000000c", created.revisionId, "CommitEntities", entity()));
    expect((repository.head?.snapshot as ProjectSnapshot).entities).toHaveLength(1);

    const revised = await service.execute(command("00000000-0000-4000-8000-00000000000d", written.revisionId, "ReviseEntities", entity({ entityType: "撑栱" })));
    const after = (repository.head?.snapshot as ProjectSnapshot).entities;
    // 修订是替换不是追加：条数不变，类别变了
    expect(after).toHaveLength(1);
    expect(after[0]?.entityType).toBe("撑栱");

    await expect(service.execute(command(
      "00000000-0000-4000-8000-00000000000e",
      revised.revisionId,
      "ReviseEntities",
      entity({ id: "00000000-0000-4000-8000-00000000000f" }),
    ))).rejects.toMatchObject({ code: "COMMAND_INVALID" });
  });

  it("现状记录写入人工来源并拒绝无证据引用的记录", async () => {
    const { repository, service } = setup();
    const created = await service.execute(createProjectCommand());
    const observation = (evidenceRefs: string[]) => ({
      commandType: "CommitObservations",
      commandId: "00000000-0000-4000-8000-00000000000a",
      projectId: ids.project,
      actorId: ids.actor,
      expectedRevisionId: created.revisionId,
      issuedAt: "2026-08-16T00:00:00Z",
      payload: {
        observations: [{
          id: "00000000-0000-4000-8000-00000000000b",
          subjectRef: ids.building,
          observationType: "damage",
          text: "西侧檐柱柱脚可见糟朽",
          producer: { producerType: "human", actorId: ids.actor, actionRef: { commandId: "00000000-0000-4000-8000-00000000000a" } },
          evidenceRefs,
          dataStatus: "available",
        }],
      },
    });
    // 无证据引用的现状记录必须被域模型拒绝
    await expect(service.execute(observation([]))).rejects.toBeTruthy();
    await service.execute(observation(["evidence:site-photo-1"]));
    const stored = (repository.head?.snapshot as ProjectSnapshot).observations[0];
    expect(stored?.producer.producerType).toBe("human");
    expect(stored?.evidenceRefs).toEqual(["evidence:site-photo-1"]);
  });

  // 规则核对一律作废未解决问题是本产品最不该有的行为：跑一次核对就把上一轮
  // 没人处理过的问题标成已被替代并盖上解决时间。几何作业为记一条输入闭合检查
  // 也发这条命令，三个演示项目共 13 条真实问题因此在问题队列与交付阻断里同时消失。
  it("规则核对只作废本轮重新提出的问题，没提的保持未解决", async () => {
    const { repository, service } = setup();
    const created = await service.execute(createProjectCommand());

    const ruleRun = (id: string, revisionId: string, issueRefs: string[], at: string) => ({
      id,
      projectId: ids.project,
      inputRevisionId: revisionId,
      ruleSetVersion: "heritage-baseline/1.0",
      status: "completed",
      producer: { producerType: "rule", ruleRunId: id },
      results: [{
        ruleId: "evidence-closure",
        outcome: issueRefs.length ? "issue" : "passed",
        inputRefs: [ids.building],
        issueRefs,
        message: "资料闭合核对",
      }],
      startedAt: at,
      completedAt: at,
    });

    const issue = (id: string, runId: string, issueType: string, subjectRefs: string[], at: string) => ({
      id,
      projectId: ids.project,
      issueType,
      subjectRefs,
      description: "本项目没有任何现场实测记录",
      sourceRef: runId,
      status: "open",
      impactRefs: [],
      blocksProxyOutcome: false,
      blocksFormalEligibility: true,
      producer: { producerType: "rule", ruleRunId: runId },
      createdAt: at,
      resolvedAt: null,
    });

    const runOne = "00000000-0000-4000-8000-0000000000c1";
    const issueOne = "00000000-0000-4000-8000-0000000000d1";
    const first = await service.execute({
      commandType: "CommitRuleEvaluation",
      commandId: "00000000-0000-4000-8000-0000000000e1",
      projectId: ids.project,
      actorId: ids.actor,
      expectedRevisionId: created.revisionId,
      issuedAt: "2026-08-11T00:02:00Z",
      payload: {
        ruleRun: ruleRun(runOne, created.revisionId, [issueOne], "2026-08-11T00:02:00Z"),
        issues: [issue(issueOne, runOne, "missingEvidence", [ids.building], "2026-08-11T00:02:00Z")],
      },
    });
    expect((repository.head?.snapshot as ProjectSnapshot).issues.filter((item) => item.status === "open")).toHaveLength(1);

    // 第二次核对是几何输入闭合，一条问题都没提，上一轮那条必须还在
    const runTwo = "00000000-0000-4000-8000-0000000000c2";
    const second = await service.execute({
      commandType: "CommitRuleEvaluation",
      commandId: "00000000-0000-4000-8000-0000000000e2",
      projectId: ids.project,
      actorId: ids.actor,
      expectedRevisionId: first.revisionId,
      issuedAt: "2026-08-11T00:03:00Z",
      payload: { ruleRun: ruleRun(runTwo, first.revisionId, [], "2026-08-11T00:03:00Z"), issues: [] },
    });
    const afterEmpty = (repository.head?.snapshot as ProjectSnapshot).issues;
    expect(afterEmpty).toHaveLength(1);
    expect(afterEmpty[0]?.status).toBe("open");
    expect(afterEmpty[0]?.resolvedAt).toBeNull();

    // 第三次重新提出同一类同一对象的问题，旧的才让位给新的
    const runThree = "00000000-0000-4000-8000-0000000000c3";
    const issueThree = "00000000-0000-4000-8000-0000000000d3";
    const third = await service.execute({
      commandType: "CommitRuleEvaluation",
      commandId: "00000000-0000-4000-8000-0000000000e3",
      projectId: ids.project,
      actorId: ids.actor,
      expectedRevisionId: second.revisionId,
      issuedAt: "2026-08-11T00:04:00Z",
      payload: {
        ruleRun: ruleRun(runThree, second.revisionId, [issueThree], "2026-08-11T00:04:00Z"),
        issues: [issue(issueThree, runThree, "missingEvidence", [ids.building], "2026-08-11T00:04:00Z")],
      },
    });
    const afterReraise = (repository.head?.snapshot as ProjectSnapshot).issues;
    expect(afterReraise).toHaveLength(2);
    expect(afterReraise.find((item) => item.id === issueOne)?.status).toBe("superseded");
    expect(afterReraise.find((item) => item.id === issueThree)?.status).toBe("open");

    const inputRunId = crypto.randomUUID(); const inputIssueId = crypto.randomUUID(); const at = "2026-08-11T00:05:00Z";
    const inputRun = ruleRun(inputRunId, third.revisionId, [inputIssueId], at);
    inputRun.results[0]!.ruleId = "parsed-evidence-required";
    const fourth = await service.execute({ commandType: "CommitRuleEvaluation", commandId: crypto.randomUUID(), projectId: ids.project, actorId: ids.actor, expectedRevisionId: third.revisionId, issuedAt: at, payload: {
      ruleRun: inputRun, issues: [{ ...issue(inputIssueId, inputRunId, "missingEvidence", [ids.building], at), sourceRef: "rule:parsed-evidence-required", description: "当前没有可读资料" }],
    } });
    expect(repository.head!.snapshot.issues.find((item) => item.id === issueThree)?.status).toBe("open");
    const professionalRunId = crypto.randomUUID(); const professionalIssueId = crypto.randomUUID();
    const professional = await service.execute({ commandType: "CommitRuleEvaluation", commandId: crypto.randomUUID(), projectId: ids.project, actorId: ids.actor, expectedRevisionId: fourth.revisionId, issuedAt: "2026-08-11T00:05:30Z", payload: {
      ruleRun: ruleRun(professionalRunId, fourth.revisionId, [professionalIssueId], "2026-08-11T00:05:30Z"), issues: [issue(professionalIssueId, professionalRunId, "missingEvidence", [ids.building], "2026-08-11T00:05:30Z")],
    } });
    expect(repository.head!.snapshot.issues.find((item) => item.id === inputIssueId)?.status).toBe("open");
    const recoveredRun = ruleRun(crypto.randomUUID(), professional.revisionId, [], "2026-08-11T00:06:00Z");
    recoveredRun.results[0]!.ruleId = "parsed-evidence-required";
    await service.execute({ commandType: "CommitRuleEvaluation", commandId: crypto.randomUUID(), projectId: ids.project, actorId: ids.actor, expectedRevisionId: professional.revisionId, issuedAt: "2026-08-11T00:06:00Z", payload: { ruleRun: recoveredRun, issues: [] } });
    expect(repository.head!.snapshot.issues.find((item) => item.id === inputIssueId)?.status).toBe("superseded");
    expect(repository.head!.snapshot.issues.find((item) => item.id === professionalIssueId)?.status).toBe("open");
  });

  // 实施单元 09：复核签发记录只能指向本项目已有的几何版本，同一草案只签一次
  it("复核签发记录追加进快照，几何版本不存在或重复签发被拒", async () => {
    const { repository, service } = setup();
    const created = await service.execute(createProjectCommand());
    const geometryId = "00000000-0000-4000-8000-0000000000e1";
    const draftId = "00000000-0000-4000-8000-0000000000e2";
    const signoff = (id: string, geometryRevisionId: string, revisionId: string) => ({
      id, projectId: ids.project, projectRevisionId: revisionId, deliveryDraftId: draftId, geometryRevisionId,
      reviewerRole: "professionalReviewer", reviewerActorId: ids.actor,
      reviewedAt: "2026-08-20T00:00:00Z", signedAt: "2026-08-20T00:00:00Z", issuingEnvironment: "formal",
      l1Eligible: true, statementZh: "复核通过，准予归档。",
    });
    const command = (commandId: string, revisionId: string, geometryRevisionId: string) => ({
      commandType: "RecordReviewSignoff", commandId, projectId: ids.project, actorId: ids.actor,
      expectedRevisionId: revisionId, issuedAt: "2026-08-20T00:00:00Z",
      payload: { signoff: signoff(commandId, geometryRevisionId, revisionId) },
    });

    // 项目里还没有几何版本，签不了
    await expect(service.execute(command("00000000-0000-4000-8000-0000000000e3", created.revisionId, geometryId))).rejects.toMatchObject({ code: "COMMAND_INVALID" });

    // 直接把几何版本放进快照（签发只看版本是否存在，不重跑几何链路）
    repository.head = {
      ...repository.head!,
      snapshot: {
        ...repository.head!.snapshot,
        geometryRevisions: [{
          id: geometryId, projectId: ids.project, projectRevisionId: created.revisionId, geometrySpecId: "00000000-0000-4000-8000-0000000000e4",
          inputHash: "1".repeat(64), entityClosureHash: "2".repeat(64), interfaceClosureHash: "3".repeat(64), geometrySignature: "4".repeat(64), assets: [],
          status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, blockers: ["PROXY_ONLY"], createdAt: "2026-08-19T00:00:00Z",
        }] as unknown as ProjectSnapshot["geometryRevisions"],
      },
    };
    const signed = await service.execute(command("00000000-0000-4000-8000-0000000000e5", repository.head!.revisionId, geometryId));
    expect(repository.head?.snapshot.reviewSignoffs).toHaveLength(1);
    expect(repository.head?.snapshot.reviewSignoffs[0]?.l1Eligible).toBe(true);

    await expect(service.execute(command("00000000-0000-4000-8000-0000000000e6", signed.revisionId, geometryId))).rejects.toMatchObject({ code: "COMMAND_INVALID" });
  });
});

async function deliveryUnitFixture(taskUnit: "mm" | "cm" | "m" = "mm", modelUnit?: "mm" | "cm" | "m", drawingUnit?: "mm" | "cm" | "m") {
  const context = setup();
  await context.service.execute(createProjectCommand());
  const revisionId = context.repository.head!.revisionId;
  const at = "2026-10-01T00:00:00Z";
  const spec: ProjectDrivenGeometrySpec = {
    schemaVersion: "2.0", id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, buildingId: ids.building,
    inputHash: "1".repeat(64), ...(modelUnit ? { outputUnit: modelUnit } : {}),
    coordinateSystem: { name: "local", axisOrder: "XYZ", upAxis: "Z", lengthUnit: "mm", origin: [0, 0, 0] },
    tolerances: { modellingMm: 0.5, interfaceMm: 0.5, tessellationMm: 1 },
    objects: [{ id: crypto.randomUUID(), stableKey: "wall", parentId: null, componentType: "wall", displayNameZh: "墙", materialCode: "documented",
      solid: { kind: "box", sizeX: "6100.5", sizeY: "300", sizeZ: "3000", centerMm: [0, 0, 0] }, parameters: [],
      producer: { producerType: "rule", ruleRunId: crypto.randomUUID() }, factRefs: [], evidenceRefs: [], unknownRefs: [] }],
    interfaces: [], unknowns: [], createdAt: at,
  };
  const geometry: GeometryRevision = {
    id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, geometrySpecId: spec.id, inputHash: spec.inputHash,
    entityClosureHash: "2".repeat(64), interfaceClosureHash: "3".repeat(64), geometrySignature: "4".repeat(64),
    assets: (["ifc", "glb", "manifest", "sourceMap", "report", "preview"] as const).map((kind) => ({ kind, assetId: crypto.randomUUID(), sha256: "5".repeat(64), mimeType: "application/json", byteLength: 10 })),
    status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, blockers: ["PROFESSIONAL_REVIEW_REQUIRED"], createdAt: at,
  };
  const viewId = crypto.randomUUID(); const sheetId = crypto.randomUUID();
  const matrix: ArtifactRequirementMatrix = {
    schemaVersion: "1.0", id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, geometryRevisionId: geometry.id,
    ...(drawingUnit ? { outputUnit: drawingUnit } : {}), titleZh: "测绘图", buildingDisplayNameZh: "测试建筑", issueState: "proxy-unissued", issueDate: null, revisionLabel: "P01",
    views: [{ id: viewId, key: "plan", displayLabelZh: "平面图", drawingRef: "P01", kind: "floorPlan", scaleDenominator: 50, sheetId, viewportRectMm: [20, 20, 350, 250],
      direction: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], sourceTypes: [], sourceEntityIds: [], sourceEvidenceRefs: [], detailRules: [], annotationRules: [],
      annotationPlan: { axes: [], levels: [], labels: [], sectionMarks: [], detailIndexes: [], levelConflicts: [], northAngleDeg: null, droppedByKind: {} } }],
    sheets: [{ id: sheetId, drawingNumber: "P01", displayLabelZh: "平面图", pageMm: [420, 297], viewIds: [viewId] }], observationCandidates: [], createdAt: at,
  };
  const artifact = (kind: ArtifactRecord["kind"], requirementMatrixId: string | null): ArtifactRecord => ({
    id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, geometryRevisionId: geometry.id, requirementMatrixId, kind, fileName: `${kind}.dat`,
    assetId: crypto.randomUUID(), sha256: "6".repeat(64), mimeType: "application/json", byteLength: 20, status: "generated-not-qualified", l1Eligible: false, formalEligibility: false,
    sourceRefs: [geometry.id], blockers: ["PROFESSIONAL_REVIEW_REQUIRED"], createdAt: at,
  });
  const ifc: ArtifactRecord = { ...artifact("ifc", null), ...geometry.assets[0]!, kind: "ifc" };
  const drawing = artifact("dxf", matrix.id); const report = artifact("checkReport", matrix.id); const manifestArtifact = artifact("deliveryManifest", null);
  const checkRun: CheckRun = {
    id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, geometryRevisionId: geometry.id, artifactRefs: [drawing.id, report.id], status: "completed",
    results: [{ code: "HASH_CLOSURE", outcome: "passed", message: "文件检查通过。", sourceRefs: [geometry.id] }], reportAssetId: report.assetId, reportHash: report.sha256,
    qualification: "generated-not-qualified", l1Eligible: false, formalEligibility: false, completedAt: at,
  };
  const evaluation: DeliveryEvaluation = {
    id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, geometryRevisionId: geometry.id, artifactRefs: [ifc.id, drawing.id, report.id], checkRunRefs: [checkRun.id],
    outcome: "proxy-ready", blockerCodes: ["PROFESSIONAL_REVIEW_REQUIRED"], formalEligibility: false, evaluatedAt: at,
  };
  const draftPayload = {
    draft: { id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: revisionId, geometryRevisionId: geometry.id, evaluationId: evaluation.id,
      artifactRefs: [...evaluation.artifactRefs, manifestArtifact.id], manifestAssetId: manifestArtifact.assetId, manifestHash: manifestArtifact.sha256,
      status: "proxy-unissued", l1Eligible: false, formalEligibility: false, signatureStatus: "unsigned", restrictions: ["待签发成果。"], createdAt: at },
    manifestArtifact,
    manifestAsset: { id: manifestArtifact.assetId, projectId: ids.project, fileName: "delivery-manifest.json", mimeType: manifestArtifact.mimeType,
      byteLength: manifestArtifact.byteLength, sha256: manifestArtifact.sha256, contentStatus: "available", createdAt: at }, stagingSessionId: crypto.randomUUID(),
  };
  context.repository.head = { ...context.repository.head!, snapshot: { ...context.repository.head!.snapshot, geometrySpecs: [spec], geometryRevisions: [geometry],
    taskDefinitions: [{ id: crypto.randomUUID(), name: "测绘任务", scope: ["建筑测绘"], regulationRefs: [], deliverables: ["模型", "图纸"], responsibilities: [{ role: "projectLead", actorId: ids.actor }],
      automationPolicyRef: null, productionSetup: { buildingId: ids.building, purpose: "existingSurvey", outputUnit: taskUnit, targets: ["model", "floorPlan"], projectGroup: null }, confirmedAt: at }] } };
  for (const item of [ifc, drawing, report]) context.repository.artifacts.set(item.id, item);
  context.repository.matrices.set(matrix.id, matrix); context.repository.checks.set(checkRun.id, checkRun);
  const command = (commandType: string, payload: unknown) => ({ commandType, commandId: crypto.randomUUID(), projectId: ids.project, actorId: ids.actor,
    expectedRevisionId: context.repository.head!.revisionId, issuedAt: at, payload });
  const changeTaskUnit = (unit: "mm" | "cm" | "m") => { context.repository.head!.snapshot.taskDefinitions[0]!.productionSetup!.outputUnit = unit; };
  return { ...context, spec, geometry, matrix, ifc, drawing, report, checkRun, evaluation, draftPayload, at, command, changeTaskUnit };
}

describe("delivery output unit commands", () => {
  it("任务单位改变后直接提交 proxy-ready 评估不能绕过模型和图纸单位校验", async () => {
    const fixture = await deliveryUnitFixture();
    fixture.changeTaskUnit("m");
    const before = fixture.repository.commitCount;
    await expect(fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }))).rejects.toMatchObject({ code: "COMMAND_INVALID", message: "delivery artifact output unit does not match current task" });
    expect(fixture.repository.commitCount).toBe(before);
    expect(fixture.repository.evaluations.has(fixture.evaluation.id)).toBe(false);
  });

  it("新单位图纸可以基于旧毫米几何独立交付，加入旧单位 IFC 后拒绝", async () => {
    const fixture = await deliveryUnitFixture("m", "mm", "m");
    await expect(fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }))).rejects.toMatchObject({ message: "delivery artifact output unit does not match current task" });
    fixture.evaluation.artifactRefs = [fixture.drawing.id, fixture.report.id];
    await fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }));
    fixture.draftPayload.draft.artifactRefs = [...fixture.evaluation.artifactRefs, fixture.draftPayload.manifestArtifact.id];
    await expect(fixture.service.execute(fixture.command("CreateDeliveryDraft", fixture.draftPayload))).resolves.toMatchObject({ commandType: "CreateDeliveryDraft" });
  });

  it("旧单位 IFC 不能通过绑定新单位图纸矩阵绕过规格校验", async () => {
    const fixture = await deliveryUnitFixture("m", "mm", "m");
    fixture.repository.artifacts.set(fixture.ifc.id, { ...fixture.ifc, requirementMatrixId: fixture.matrix.id });
    fixture.repository.evaluations.set(fixture.evaluation.id, fixture.evaluation);
    await expect(fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }))).rejects.toMatchObject({ message: "delivery artifact output unit does not match current task" });
    await expect(fixture.service.execute(fixture.command("CreateDeliveryDraft", fixture.draftPayload))).rejects.toMatchObject({ message: "delivery artifact output unit does not match current task" });
  });

  it.each(["mm", "cm"] as const)("已保存的 %s proxy-ready 评估不能用于当前米单位草案", async (unit) => {
    const fixture = await deliveryUnitFixture(unit, unit, unit);
    await fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }));
    fixture.changeTaskUnit("m");
    const before = fixture.repository.commitCount;
    await expect(fixture.service.execute(fixture.command("CreateDeliveryDraft", fixture.draftPayload))).rejects.toMatchObject({ code: "COMMAND_INVALID", message: "delivery artifact output unit does not match current task" });
    expect(fixture.repository.commitCount).toBe(before);
    expect(fixture.repository.artifacts.has(fixture.draftPayload.manifestArtifact.id)).toBe(false);
  });

  it("按实际图纸矩阵校验，不能使用最新矩阵使旧图纸适用", async () => {
    const fixture = await deliveryUnitFixture("m", "m", "cm");
    const latest = { ...fixture.matrix, id: crypto.randomUUID(), outputUnit: "m" as const };
    fixture.repository.matrices.set(latest.id, latest);
    fixture.repository.evaluations.set(fixture.evaluation.id, fixture.evaluation);
    await expect(fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }))).rejects.toMatchObject({ message: "delivery artifact output unit does not match current task" });
    await expect(fixture.service.execute(fixture.command("CreateDeliveryDraft", fixture.draftPayload))).rejects.toMatchObject({ message: "delivery artifact output unit does not match current task" });
  });

  it("单位改变不阻止旧成果技术检查和 blocked 评估保存", async () => {
    const fixture = await deliveryUnitFixture("m");
    const checkRun = { ...fixture.checkRun, id: crypto.randomUUID() };
    await expect(fixture.service.execute(fixture.command("CommitCheckRun", { checkRun }))).resolves.toMatchObject({ commandType: "CommitCheckRun" });
    const evaluation = { ...fixture.evaluation, outcome: "blocked", blockerCodes: ["OUTPUT_UNIT_MISMATCH"] };
    await expect(fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation }))).resolves.toMatchObject({ commandType: "EvaluateDelivery" });
  });

  it("签发按明确几何版本校验单位，最新模型不能覆盖旧版", async () => {
    const fixture = await deliveryUnitFixture("m", "mm", "m");
    fixture.repository.head!.snapshot.geometrySpecs.push({ ...fixture.spec, id: crypto.randomUUID(), outputUnit: "m" });
    fixture.repository.head!.snapshot.geometryRevisions.push({ ...fixture.geometry, id: crypto.randomUUID(), geometrySpecId: fixture.repository.head!.snapshot.geometrySpecs.at(-1)!.id });
    const signoff = { id: crypto.randomUUID(), projectId: ids.project, projectRevisionId: fixture.repository.head!.revisionId, deliveryDraftId: crypto.randomUUID(), geometryRevisionId: fixture.geometry.id,
      reviewerRole: "professionalReviewer", reviewerActorId: ids.actor, reviewedAt: fixture.at, signedAt: fixture.at, issuingEnvironment: "formal", l1Eligible: false, statementZh: "复核通过。" };
    await expect(fixture.service.execute(fixture.command("RecordReviewSignoff", { signoff }))).rejects.toMatchObject({ code: "COMMAND_INVALID", message: "review signoff geometry output unit does not match current task" });
    expect(fixture.repository.head!.snapshot.reviewSignoffs).toEqual([]);
  });

  it("旧毫米记录仍可交付并保留缺省字段，历史包当前单位不同也可导入", async () => {
    const fixture = await deliveryUnitFixture();
    const serialized = JSON.stringify([fixture.spec, fixture.matrix]);
    await fixture.service.execute(fixture.command("EvaluateDelivery", { evaluation: fixture.evaluation }));
    await fixture.service.execute(fixture.command("CreateDeliveryDraft", fixture.draftPayload));
    expect(JSON.stringify([fixture.spec, fixture.matrix])).toBe(serialized);
    expect(fixture.spec).not.toHaveProperty("outputUnit"); expect(fixture.matrix).not.toHaveProperty("outputUnit");
    fixture.changeTaskUnit("m");
    const imported = setup(); const eventHash = "a".repeat(64);
    const sourceAuditEvents = [{ id: crypto.randomUUID(), projectId: ids.project, commandId: crypto.randomUUID(), actorId: ids.actor, previousEventHash: null,
      writeSet: [], writeSetHash: "b".repeat(64), outcome: "committed", errorCode: null, eventHash, recordHash: "c".repeat(64), occurredAt: fixture.at }];
    await expect(imported.service.execute({ ...fixture.command("ImportProjectSnapshot", {
      snapshot: fixture.repository.head!.snapshot, sourceRevisionId: fixture.repository.head!.revisionId, sourceAuditHeadHash: eventHash, sourceAuditEvents,
      assets: [], modelRuns: [], ruleRuns: [], decisions: [], artifactRequirementMatrices: [fixture.matrix], artifacts: [...fixture.repository.artifacts.values()],
      checkRuns: [fixture.checkRun], deliveryEvaluations: [fixture.evaluation], deliveries: [fixture.draftPayload.draft], assetSessionId: null, packageHash: "d".repeat(64),
    }), expectedRevisionId: null })).resolves.toMatchObject({ commandType: "ImportProjectSnapshot" });
    expect(imported.repository.head!.snapshot.geometrySpecs[0]).not.toHaveProperty("outputUnit");
    expect(imported.repository.evaluations.get(fixture.evaluation.id)?.outcome).toBe("proxy-ready");
  });
});
