// @vitest-environment node
import { Blob as NativeBlob } from "node:buffer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSnapshotSchema } from "@gujian/domain";
import { createLocalProject, saveProductionTask, prepareEvidenceFiles, projectRepository, projectPackages, workflow, localActorId, evidenceIngestion } from "./workbench";
import { emptyProductionTask, readProductionTask, type PreparedFile } from "./production-task";
import { sampleTask } from "./test/task-fixture";
const values = () => ({ ...emptyProductionTask(), taskName: "单页保存测试", buildingName: "测试山门", outputUnit: "m" as const, projectGroup: "测试村落", buildingType: "门楼", mainStructure: "木结构" });
const file = (name: string, content: string): File => Object.assign(new NativeBlob([content], { type: "text/plain" }), { name }) as unknown as File;
const actorStorage = new Map<string,string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => actorStorage.get(key) ?? null, setItem: (key: string, value: string) => actorStorage.set(key, value) });
beforeEach(() => projectRepository.clearAllData());
afterEach(() => vi.restoreAllMocks());
describe("单页制作任务保存", () => {
  it("初次创建原子保存任务与建筑，文件层级与输出单位回导保持", async () => {
    const v = values(); let head = await createLocalProject({ name: v.taskName, buildingName: v.buildingName, locationText: "", production: v });
    expect(readProductionTask(head.snapshot)).toEqual(v);
    expect(head.snapshot.taskDefinitions[0]!.artifactRequirements).toBeUndefined();
    const files: PreparedFile[] = [{ file: file("资料.txt", "测试尺寸 6000 mm"), level: "required" }];
    head = (await prepareEvidenceFiles(head, files)).head;
    expect(head.snapshot.evidences[0]!.preparationLevel).toBe("required");
    const snapshot = head.snapshot;
    const bundle = await projectPackages.exportZip(head.projectId);
    await projectRepository.clearAllData();
    const imported = await projectPackages.import(bundle, "任务.gujian.zip", localActorId());
    const recovered = (await projectRepository.getProjectHead(imported))!;
    expect(readProductionTask(recovered.snapshot)).toEqual(v);
    expect(recovered.snapshot.evidences).toEqual(snapshot.evidences);
    expect(recovered.snapshot.buildings[0]!.id).toBe(snapshot.buildings[0]!.id);
  });
  it("单个文件失败继续保存下一份，错误包含具体名称", async () => {
    const v = values(); const head = await createLocalProject({ name: v.taskName, buildingName: v.buildingName, locationText: "", production: v });
    const prepared = await prepareEvidenceFiles(head, [{ file: file("空文件.txt", ""), level: "additional" }, { file: file("可读资料.txt", "test"), level: "recommended" }]);
    expect(prepared.failures).toHaveLength(1); expect(prepared.failures[0]).toContain("空文件.txt");
    expect(prepared.head.snapshot.evidences.map((e) => e.title)).toEqual(["可读资料.txt"]);
    expect(prepared.head.snapshot.evidences[0]!.preparationLevel).toBe("recommended");
    expect((await projectRepository.listProjects())).toHaveLength(1);
  });
  it("修改基本设置保持建筑编号、资料、出图要求；图纸修改保持新属性", async () => {
    const v = values(); let head = await createLocalProject({ name: "旧任务", buildingName: v.buildingName, locationText: "" });
    head = await workflow.confirmTaskSetup(head, localActorId(), { taskName: sampleTask.name, scope: sampleTask.scope, regulationRefs: sampleTask.regulationRefs, deliverables: sampleTask.deliverables, artifactRequirements: sampleTask.artifactRequirements! });
    const buildingId = head.snapshot.buildings[0]!.id;
    head = (await prepareEvidenceFiles(head, [{ file: file("原始资料.txt", "source"), level: "required" }])).head;
    const before = head.snapshot.evidences;
    head = await saveProductionTask(head, { ...v, buildingName: "修改建筑名" });
    expect(head.snapshot.buildings[0]!.id).toBe(buildingId); expect(head.snapshot.buildings[0]!.name).toBe("修改建筑名");
    expect(head.snapshot.evidences).toEqual(before); expect(head.snapshot.taskDefinitions[0]!.artifactRequirements).toEqual(sampleTask.artifactRequirements);
    const setup = head.snapshot.taskDefinitions[0]!.productionSetup;
    head = await workflow.replaceTaskDefinition(head, localActorId(), { taskName: head.snapshot.taskDefinitions[0]!.name, scope: sampleTask.scope, regulationRefs: [], deliverables: ["首层平面"], artifactRequirements: sampleTask.artifactRequirements! });
    expect(head.snapshot.taskDefinitions[0]!.productionSetup).toEqual(setup);
  });
  it("旧项目不推断缺失属性，错误建筑关联无法写入", async () => {
    const head = await createLocalProject({ name: "旧记录", buildingName: "旧建筑", locationText: "" });
    expect(ProjectSnapshotSchema.parse(head.snapshot).taskDefinitions).toEqual([]);
    const saved = await saveProductionTask(head, values());
    const wrong = structuredClone(saved.snapshot); wrong.taskDefinitions[0]!.productionSetup!.buildingId = crypto.randomUUID();
    expect(ProjectSnapshotSchema.safeParse(wrong).success).toBe(false);
    expect(saved.snapshot.taskDefinitions[0]!.productionSetup!.outputUnit).toBe("m");
  });
  it("保存失败不修改既有项目", async () => {
    const head = await createLocalProject({ name: "旧记录", buildingName: "旧建筑", locationText: "" });
    vi.spyOn(evidenceIngestion, "ingest").mockRejectedValueOnce(new Error("STORAGE_WRITE_FAILED"));
    const result = await prepareEvidenceFiles(head, [{ file: file("失败资料.txt", "source"), level: "required" }]);
    expect(result.failures[0]).toContain("失败资料.txt"); expect(result.head.snapshot).toEqual(head.snapshot);
  });
});
