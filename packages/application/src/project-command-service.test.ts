import type { ProjectSnapshot } from "@gujian/domain";
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
  commitCount = 0;
  transactionCount = 0;
  failNextCommit = false;
  lastMutation: CommitProjectMutation | null = null;

  async transaction<T>(_projectId: string, operation: (transaction: ProjectTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const startingHead = this.head;
    const startingReceipts = new Map(this.receipts);
    const pending = { head: startingHead, receipts: startingReceipts };
    const transaction: ProjectTransaction = {
      getCommandReceipt: async (commandId) => pending.receipts.get(commandId) ?? null,
      getProjectHead: async () => pending.head,
      getCadJob: async () => null,
      getArtifactRequirementMatrix: async () => null,
      getArtifact: async () => null,
      getCheckRun: async () => null,
      getDeliveryEvaluation: async () => null,
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
        this.lastMutation = mutation;
        return receipt;
      },
    };

    const result = await operation(transaction);
    if (pending.head !== startingHead || pending.receipts.size !== startingReceipts.size) {
      this.head = pending.head;
      this.receipts = pending.receipts;
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
    await service.execute({
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
  });
});
