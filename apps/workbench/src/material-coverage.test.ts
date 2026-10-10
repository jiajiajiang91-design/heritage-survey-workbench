// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { IndexedDbProjectRepository, ProjectPackageService, openWorkbenchDatabase } from "@gujian/infrastructure";
import { coverageEntries, coverageRequirements, commitMaterialCoverage, materialCoverage } from "./material-coverage";
import { componentFixture } from "./test/component-fixture";
import { localActorId, projectCommands, projectPackages, projectRepository } from "./workbench";
import { emptyProductionTask, taskFromProduction } from "./production-task";
import { currentDimensionCount } from "./dimension-review";
import { buildProvenanceGraphView } from "./query-models";
const actor = crypto.randomUUID(); vi.stubGlobal("localStorage", { getItem: () => actor, setItem: () => undefined });
const entries = [{ purpose: "plan" as const, sourceLocation: "内部第 1 页，首层" }, { purpose: "scale" as const, sourceLocation: "内部总宽 6000 mm 标注" }];
async function saved() { const test = await componentFixture(); const evidenceId = test.head.snapshot.evidences[0]!.id;
  const head = await commitMaterialCoverage({ head: test.head, evidenceId, entries, actorId: localActorId(), commands: projectCommands, repository: projectRepository }); return { head, evidenceId }; }
describe("资料与成果覆盖", () => {
  it("保存和清空覆盖均不增加尺寸与来源图的尺寸记录", async () => {
    const { head, evidenceId } = await saved();
    const cleared = await commitMaterialCoverage({ head, evidenceId, entries: [], actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    for (const current of [head, cleared]) {
      expect(currentDimensionCount(current.snapshot)).toBe(1);
      const graph = buildProvenanceGraphView({ head: current, modelRuns: [], ruleRuns: [], decisions: [], artifacts: [], checks: [], evaluations: [], deliveries: [] }, null);
      expect(graph.nodes.find((node) => node.key === "fact")?.refs).toEqual([current.snapshot.facts[0]!.id]);
    }
  });
  it("按所选成果改变要求，旧任务未设置目标时不推断", () => {
    expect(coverageRequirements([])).toEqual([]); expect(coverageRequirements(["floorPlan"])).toEqual(["plan", "scale"]);
    expect(coverageRequirements(["model", "elevation", "section"])).toEqual(["plan", "scale", "height", "elevation", "section"]);
  });
  it("可读文件不自动登记，同文件多个用途经真实命令保存并清空", async () => {
    const test = await componentFixture(); const evidenceId = test.head.snapshot.evidences[0]!.id;
    expect(coverageEntries(test.head.snapshot, evidenceId)).toEqual([]);
    const { head, evidenceId: id } = await saved(); expect(coverageEntries(head.snapshot, id)).toEqual(entries);
    const cleared = await commitMaterialCoverage({ head, evidenceId: id, entries: [], actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    expect(coverageEntries(cleared.snapshot, id)).toEqual([]); expect(cleared.snapshot.facts.filter((fact) => fact.subjectRef === id)).toHaveLength(2);
  });
  it("无位置、重复类别和错误资料不能写入", async () => {
    const { head, evidenceId } = await saved(); const save = (id: string, value: typeof entries) => commitMaterialCoverage({ head, evidenceId: id, entries: value, actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    await expect(save(evidenceId, [{ purpose: "plan", sourceLocation: " " }])).rejects.toThrow();
    await expect(save(evidenceId, [entries[0]!, entries[0]!])).rejects.toThrow(); await expect(save(crypto.randomUUID(), entries)).rejects.toThrow();
  });
  it("新登记失效不退回旧值，最新读取失败或原件缺失均排除", async () => {
    const { head, evidenceId } = await saved(); const fact = head.snapshot.facts.at(-1)!;
    for (const state of ["rejected", "stale", "failed", "missing"] as const) { const snapshot = structuredClone(head.snapshot);
      if (state === "rejected") snapshot.facts.push({ ...fact, id: crypto.randomUUID(), reviewStatus: "rejected" });
      if (state === "stale") snapshot.facts.push({ ...fact, id: crypto.randomUUID(), dataStatus: "stale" });
      if (state === "failed") snapshot.parseRecords.push({ ...snapshot.parseRecords[0]!, id: crypto.randomUUID(), readability: "failed", status: "failed" });
      if (state === "missing") snapshot.evidences[0]!.dataStatus = "missing";
      expect(coverageEntries(snapshot, evidenceId)).toEqual([]);
    }
  });
  it("层级不改变覆盖，目标增加后显示新增缺项，错误建筑不回退", async () => {
    const { head, evidenceId } = await saved(); const snapshot = structuredClone(head.snapshot); snapshot.evidences[0]!.preparationLevel = "additional";
    const task = taskFromProduction({ ...emptyProductionTask(), taskName: "内部覆盖测试", buildingName: "内部建筑", targets: ["floorPlan"] }, snapshot.buildings[0]!.id, localActorId()); snapshot.taskDefinitions.push(task);
    expect(materialCoverage(snapshot).map((row) => row.sources.length)).toEqual([1, 1]); task.productionSetup!.targets.push("model");
    expect(materialCoverage(snapshot).map((row) => row.sources.length)).toEqual([1, 1, 0]); task.productionSetup!.buildingId = crypto.randomUUID();
    expect(coverageEntries(snapshot, evidenceId)).toEqual([]);
    await expect(commitMaterialCoverage({ head: { ...head, snapshot }, evidenceId, entries, actorId: localActorId(), commands: projectCommands, repository: projectRepository })).rejects.toThrow();
  });
  it("独立数据库回导保留原件及多用途登记", async () => {
    const { head, evidenceId } = await saved(); const bytes = await projectPackages.exportZip(head.projectId); const db = await openWorkbenchDatabase("coverage-" + crypto.randomUUID());
    try { const repo = new IndexedDbProjectRepository(db); const id = await new ProjectPackageService(repo).import(bytes, "内部.zip", localActorId());
      expect(coverageEntries((await repo.getProjectHead(id))!.snapshot, evidenceId)).toEqual(entries); expect((await repo.getProjectAssets(id))[0]!.content).not.toBeNull();
    } finally { db.close(); }
  });
});
