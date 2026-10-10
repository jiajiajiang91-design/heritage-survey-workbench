import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectHead } from "@gujian/application";
import { createLocalProject, localActorId, projectRepository, workflow } from "../workbench";
import { sampleTask } from "../test/task-fixture";
import { useRecordWrites } from "./useRecordWrites";
import type { ProjectSession } from "./useProjectSession";
import type { TaskSetupValues } from "../task-requirements";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const values = (): TaskSetupValues => ({
  taskName: sampleTask.name, scope: sampleTask.scope, deliverables: sampleTask.deliverables, regulationRefs: sampleTask.regulationRefs,
  artifactRequirements: structuredClone(sampleTask.artifactRequirements!),
});
async function emptyProject() {
  return createLocalProject({ name: "任务写入测试", buildingName: "测试建筑", locationText: "" });
}
function mount(head: ProjectHead, refresh = vi.fn().mockResolvedValue(undefined)) {
  const notices = { error: null, notice: null, setError: vi.fn(), setNotice: vi.fn() };
  const setSelected = vi.fn();
  // 本测试只提供任务写入会访问的会话依赖，仓库和命令仍使用真实实现。
  const session = {
    selected: head, confirmedTask: head.snapshot.taskDefinitions.find((task) => task.confirmedAt !== null) ?? null,
    setSelected, refresh, loadProject: vi.fn(), setProjectRuleRuns: vi.fn(),
  } as unknown as ProjectSession;
  const hook = renderHook(() => useRecordWrites({ session, notices }));
  return { ...hook, notices, setSelected };
}
describe("任务写入反馈", () => {
  it("真实写入后可重新读取，后续修订保留原命令回执", async () => {
    const head = await emptyProject();
    const first = mount(head);
    let ok = false;
    await act(async () => { ok = await first.result.current.submitTaskSetup(values()); });
    expect(ok).toBe(true);
    const initial = (await projectRepository.getProjectHead(head.projectId))!;
    const initialTask = initial.snapshot.taskDefinitions[0]!;
    expect(initialTask.artifactRequirements).toEqual(values().artifactRequirements);
    const receiptsBefore = await projectRepository.getProjectCommandReceipts(head.projectId);
    first.unmount();
    const second = mount(initial);
    const revised = values(); revised.artifactRequirements.views[0]!.scaleDenominator = 50;
    await act(async () => { ok = await second.result.current.submitTaskSetup(revised); });
    expect(ok).toBe(true);
    const saved = (await projectRepository.getProjectHead(head.projectId))!;
    expect(saved.snapshot.taskDefinitions[0]!.id).not.toBe(initialTask.id);
    expect(saved.snapshot.taskDefinitions[0]!.artifactRequirements!.views[0]!.scaleDenominator).toBe(50);
    const receiptsAfter = await projectRepository.getProjectCommandReceipts(head.projectId);
    expect(receiptsAfter.length).toBeGreaterThan(receiptsBefore.length);
    for (const receipt of receiptsBefore) expect(receiptsAfter).toContainEqual(receipt);
  });
  it("未写入时返回失败，不显示成功或替换当前项目", async () => {
    const head = await emptyProject();
    vi.spyOn(workflow, "confirmTaskSetup").mockRejectedValueOnce(new Error("STORAGE_WRITE_FAILED"));
    const hook = mount(head);
    let ok = true;
    await act(async () => { ok = await hook.result.current.submitTaskSetup(values()); });
    expect(ok).toBe(false);
    expect(hook.notices.setNotice).not.toHaveBeenCalledWith(expect.any(String));
    expect(hook.setSelected).not.toHaveBeenCalled();
    expect(hook.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
    expect((await projectRepository.getProjectHead(head.projectId))!.snapshot.taskDefinitions).toEqual([]);
  });
  it("真实命令已提交但随后自动检查失败时核实保存结果，避免诱发重复提交", async () => {
    const head = await emptyProject();
    vi.spyOn(workflow, "evaluate").mockRejectedValueOnce(new Error("RULE_READ_FAILED"));
    const hook = mount(head);
    let ok = false;
    await act(async () => { ok = await hook.result.current.submitTaskSetup(values()); });
    expect(ok).toBe(true);
    const saved = (await projectRepository.getProjectHead(head.projectId))!;
    expect(saved.snapshot.taskDefinitions).toHaveLength(1);
    expect(saved.snapshot.taskDefinitions[0]!.artifactRequirements).toEqual(values().artifactRequirements);
    expect(hook.setSelected).toHaveBeenCalledWith(saved);
    expect(hook.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
  });
  it("两个编辑视图发生冲突时不会覆盖先保存的要求", async () => {
    const initial = await workflow.confirmTaskSetup(await emptyProject(), localActorId(), values());
    const staleEditor = mount(initial);
    const other = values(); other.artifactRequirements.titleZh = "另一窗口已保存";
    await workflow.replaceTaskDefinition(initial, localActorId(), other);
    const attempt = values(); attempt.artifactRequirements.titleZh = "旧窗口草稿";
    let ok = true;
    await act(async () => { ok = await staleEditor.result.current.submitTaskSetup(attempt); });
    expect(ok).toBe(false);
    expect(staleEditor.notices.setNotice).not.toHaveBeenCalledWith(expect.any(String));
    expect((await projectRepository.getProjectHead(initial.projectId))!.snapshot.taskDefinitions[0]!.artifactRequirements!.titleZh).toBe("另一窗口已保存");
  });
  it("写入后的列表刷新失败仍按已保存处理，并显示刷新错误", async () => {
    const hook = mount(await emptyProject(), vi.fn().mockRejectedValue(new Error("LIST_READ_FAILED")));
    let ok = false;
    await act(async () => { ok = await hook.result.current.submitTaskSetup(values()); });
    expect(ok).toBe(true);
    expect(hook.notices.setNotice.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
    expect(hook.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
  });
});


