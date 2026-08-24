import { describe, expect, it } from "vitest";

import { buildChangeHistory, labelledCommandTypes } from "./change-history";

// 修改历史（界面文档表 3）。验收第 3 条要求每次修正在这里可见，含理由、
// 操作人、时间。此前工作台没有一处界面承接，数据层留痕齐全而人看不到。

const ACTOR = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    commandId: "cmd-1",
    actorId: ACTOR,
    outcome: "committed" as const,
    occurredAt: "2026-08-21T10:00:00.000Z",
    writeSet: [{ storeName: "revisions", id: "ent-1" }],
    ...overrides,
  };
}

const snapshot = {
  entities: [
    { id: "ent-1", name: "雀替", visibility: { state: "不可见" as const, needsReshoot: true, reasonZh: "被树遮挡" } },
    { id: "ent-2", name: "檐柱" },
  ],
  exclusionRecords: [{ id: "exc-1", subjectDescriptionZh: "老虎窗", reasonZh: "用户框选并说明：这个不存在" }],
  facts: [{ id: "fact-1", reasonZh: "按对称构件推算" }],
  evidences: [{ id: "ev-1", title: "现场照片：馆内现状" }],
} as unknown as Parameters<typeof buildChangeHistory>[0]["snapshot"];

describe("修改历史", () => {
  it("按时间倒序，最近的在前", () => {
    const entries = buildChangeHistory({
      auditEvents: [
        event({ id: "old", occurredAt: "2026-08-21T09:00:00.000Z" }),
        event({ id: "new", occurredAt: "2026-08-21T11:00:00.000Z" }),
      ],
      receipts: [{ commandId: "cmd-1", commandType: "CommitEntities" }],
      snapshot,
    });
    expect(entries.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("命令类型翻成中文动作名，时间与操作人都在", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event()],
      receipts: [{ commandId: "cmd-1", commandType: "CommitExclusionRecords" }],
      snapshot,
    });
    expect(entry?.actionZh).toBe("记入排除记录");
    expect(entry?.actorId).toBe(ACTOR);
    expect(entry?.occurredAt).toBe("2026-08-21T10:00:00.000Z");
  });

  it("三处理由都能反查到", () => {
    const reasonOf = (id: string) => buildChangeHistory({
      auditEvents: [event({ writeSet: [{ storeName: "revisions", id }] })],
      receipts: [{ commandId: "cmd-1", commandType: "CommitFacts" }],
      snapshot,
    })[0]?.reasonZh;
    expect(reasonOf("exc-1")).toBe("用户框选并说明：这个不存在");
    expect(reasonOf("fact-1")).toBe("按对称构件推算");
    expect(reasonOf("ent-1")).toBe("被树遮挡");
  });

  it("没有理由时如实写空，不编一个", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event({ writeSet: [{ storeName: "revisions", id: "ent-2" }] })],
      receipts: [{ commandId: "cmd-1", commandType: "CommitEntities" }],
      snapshot,
    });
    expect(entry?.reasonZh).toBeNull();
    expect(entry?.subjectsZh).toEqual(["檐柱"]);
  });

  // 认不出名字时说清动了几条，比把一串 id 摆出来有用
  it("对象认不出名字时不显示 id，只报条数", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event({ writeSet: [{ storeName: "artifacts", id: "art-9" }, { storeName: "artifacts", id: "art-8" }] })],
      receipts: [{ commandId: "cmd-1", commandType: "CommitArtifacts" }],
      snapshot,
    });
    expect(entry?.subjectsZh).toEqual([]);
    expect(entry?.writeCount).toBe(2);
  });

  // 回执缺失时显示原始类型或说明缺失，不猜一个中文名
  it("没有回执时说明动作类型未记录", () => {
    const [entry] = buildChangeHistory({ auditEvents: [event()], receipts: [], snapshot });
    expect(entry?.actionZh).toBe("未记录动作类型");
  });

  it("命令类型不在标签表里时显示原始类型", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event()],
      receipts: [{ commandId: "cmd-1", commandType: "SomeFutureCommand" }],
      snapshot,
    });
    expect(entry?.actionZh).toBe("SomeFutureCommand");
  });

  it("没有快照时仍列出写入，只是说不出对象与理由", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event()],
      receipts: [{ commandId: "cmd-1", commandType: "CommitEntities" }],
      snapshot: null,
    });
    expect(entry?.actionZh).toBe("写入构件记录");
    expect(entry?.subjectsZh).toEqual([]);
    expect(entry?.reasonZh).toBeNull();
  });

  // 领域对象的 id 在回执的 changedRefs 里，不在审计事件的写集里。写集只有
  // 项目与修订两条存储记录。早先按写集反查，界面上一律显示未记录理由，
  // 而理由一直都在，只是查错了地方。
  it("按回执的 changedRefs 反查对象与理由", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event({
        writeSet: [{ storeName: "projects", id: "proj-1" }, { storeName: "revisions", id: "rev-1" }],
      })],
      receipts: [{ commandId: "cmd-1", commandType: "CommitExclusionRecords", changedRefs: ["exc-1"] }],
      snapshot,
    });
    expect(entry?.subjectsZh).toEqual(["老虎窗"]);
    expect(entry?.reasonZh).toBe("用户框选并说明：这个不存在");
    expect(entry?.writeCount).toBe(1);
  });

  // 旧回执没有 changedRefs。退回按写集反查，查不到就如实说查不到，不报错。
  it("回执没有 changedRefs 时退回按写集反查", () => {
    const [entry] = buildChangeHistory({
      auditEvents: [event({ writeSet: [{ storeName: "revisions", id: "ent-1" }] })],
      receipts: [{ commandId: "cmd-1", commandType: "CommitEntities" }],
      snapshot,
    });
    expect(entry?.subjectsZh).toEqual(["雀替"]);
  });

  // 标签表漏一条就会在界面上显示英文命令名，实测里 CommitRuleEvaluation
  // 就这样漏了出来。这条按应用层的命令联合体逐个核对，漏一条即失败。
  it("每个命令类型都有中文动作名", async () => {
    const { ProjectCommandSchema } = await import("@gujian/application");
    const declared = ProjectCommandSchema.options
      .map((option) => (option.shape.commandType as { value: string }).value)
      .sort();
    const labelled = new Set(labelledCommandTypes());
    const missing = declared.filter((name) => !labelled.has(name));
    expect(missing, `没有中文动作名的命令：${missing.join("、")}`).toEqual([]);
  });

  it("动作标签表无重复", () => {
    const labels = labelledCommandTypes();
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// 影响范围（单元 07 第三组）。写入集与影响范围是两件事：
// 写入集是这条命令自己动了什么，影响范围是因此不能再用的下游。
describe("影响范围", () => {
  const IMPACT_SNAPSHOT = {
    schemaVersion: "3.0",
    project: { id: "prj-1" },
    buildings: [{ id: "bld-1" }],
    taskDefinitions: [], evidences: [{ id: "ev-1", title: "现场照片" }], parseRecords: [],
    entities: [], exclusionRecords: [], relations: [], observations: [], measurements: [],
    facts: [{ id: "fact-1", field: "bayCount", evidenceRefs: ["ev-1"] }],
    candidates: [], issues: [], dependencyEdges: [],
    geometrySpecs: [{ id: "spec-1", objects: [{ id: "obj-1", factRefs: ["fact-1"], evidenceRefs: [] }] }],
    geometryRevisions: [{ id: "rev-1", geometrySpecId: "spec-1" }],
    reviewSignoffs: [], adoptedRecordRefs: [],
  } as unknown as Parameters<typeof buildChangeHistory>[0]["snapshot"];

  const impactInput = {
    snapshot: IMPACT_SNAPSHOT,
    artifacts: [{ id: "art-1", geometryRevisionId: "rev-1", sourceRefs: [], requirementMatrixId: null, fileName: "GD-01.svg" }],
    requirementMatrices: [], checkRuns: [], deliveryEvaluations: [], deliveries: [],
  } as unknown as NonNullable<Parameters<typeof buildChangeHistory>[0]["impactInput"]>;

  function entryFor(changedRefs: string[]) {
    return buildChangeHistory({
      auditEvents: [event({ writeSet: [{ storeName: "revisions", id: changedRefs[0] as string }] })],
      receipts: [{ commandId: "cmd-1", commandType: "CommitFacts", changedRefs }],
      snapshot: IMPACT_SNAPSHOT,
      impactInput,
    })[0];
  }

  it("影响范围与写入集不是同一批对象", () => {
    const entry = entryFor(["ev-1"]);
    expect(entry?.writeCount).toBe(1);
    expect(entry?.impact?.total).toBe(4);
    const impacted = entry?.impact?.groups.flatMap((group) => group.names) ?? [];
    // 写入的是资料本身，影响的是它的下游，两者没有交集
    expect(impacted).not.toContain("现场照片");
  });

  it("影响范围不含写入集自身", () => {
    const entry = entryFor(["ev-1", "fact-1"]);
    const kinds = entry?.impact?.groups.map((group) => group.kind) ?? [];
    expect(kinds).not.toContain("资料");
    expect(kinds).not.toContain("尺寸记录");
    expect(kinds.sort()).toEqual(["模型版本", "模型规格", "成果"].sort());
  });

  it("没给算影响所需记录时是 null，与影响为空区分开", () => {
    const withoutInput = buildChangeHistory({
      auditEvents: [event()],
      receipts: [{ commandId: "cmd-1", commandType: "CommitEntities" }],
      snapshot,
    })[0];
    expect(withoutInput?.impact).toBeNull();

    const noDownstream = entryFor(["art-1"]);
    expect(noDownstream?.impact).not.toBeNull();
    expect(noDownstream?.impact?.total).toBe(0);
  });
});
