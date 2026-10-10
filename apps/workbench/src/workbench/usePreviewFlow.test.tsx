import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dimensionFixture, addDimensionCandidate } from "../test/dimension-fixture";
import { addComponentCandidate } from "../test/component-candidate-fixture";
import { useJobs } from "./useJobs";
import { modelRuns, projectRepository, workflow } from "../workbench";
import { emptyProductionTask, taskFromProduction } from "../production-task";
import type { ProjectSession } from "./useProjectSession";
import type { WorkspaceNav } from "./useWorkspaceNav";
import type { Notices } from "./useNotices";
import type { ProjectHead } from "@gujian/application";
afterEach(() => vi.restoreAllMocks());
async function setup(complete = true, image = false) {
  const context = await dimensionFixture(); const selected = context.head;
  if (complete) selected.snapshot.taskDefinitions = [taskFromProduction({ ...emptyProductionTask(), taskName: "预览内部测试", buildingName: "内部建筑" }, selected.snapshot.buildings[0]!.id, crypto.randomUUID())];
  if (image) { selected.snapshot.parseRecords[0]!.readability = "readable"; selected.snapshot.parseRecords[0]!.readableAs = "image"; }
  vi.spyOn(workflow, "evaluate").mockImplementation(async (head) => head);
  const session = { selected, setSelected: vi.fn(), refresh: vi.fn(), loadProject: vi.fn(), geometrySpec: null, geometryRevision: null, readableDrawingEvidenceIds: [], selectedModelEvidenceIds: selected.snapshot.evidences.map((item) => item.id), setProjectModelRuns: vi.fn() } as unknown as ProjectSession;
  const nav = { setActiveStage: vi.fn() } as unknown as WorkspaceNav;
  const notices = { setError: vi.fn(), setNotice: vi.fn() } as unknown as Notices;
  const hook = renderHook(() => useJobs({ session, nav, notices }));
  return { ...context, session, nav, notices, hook };
}
describe("生成预览流程", () => {
  it("缺少任务设置不发请求，并指出补充入口", async () => {
    const run = vi.spyOn(modelRuns, "runMeasurementTranscription"); const test = await setup(false);
    await act(async () => test.hook.result.current.generatePreview()); expect(run).not.toHaveBeenCalled(); expect(test.notices.setError).toHaveBeenCalledWith(expect.objectContaining({ summaryZh: expect.stringContaining("任务卡") }));
  });
  it("生成准备期间防止重复，成功后进入预览并保留旧候选", async () => {
    const test = await setup(); let finish!: (value: Awaited<ReturnType<typeof modelRuns.runMeasurementTranscription>>) => void;
    const run = vi.spyOn(modelRuns, "runMeasurementTranscription").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let first!: Promise<void>; act(() => { first = test.hook.result.current.generatePreview(); }); expect(test.hook.result.current.modelRunning).toBe(true);
    await act(async () => test.hook.result.current.generatePreview()); expect(run).toHaveBeenCalledOnce();
    await act(async () => { finish({ head: test.head, candidate: test.candidate, run: null! }); await first; });
    expect(test.nav.setActiveStage).toHaveBeenCalledWith("preview"); expect(test.session.setSelected).toHaveBeenCalledWith(test.head); expect(test.head.snapshot.candidates).toContainEqual(test.candidate); expect(test.hook.result.current.modelRunning).toBe(false);
  });
  it("失败不切页、不清空旧结果，可再次生成", async () => {
    const test = await setup(); const run = vi.spyOn(modelRuns, "runMeasurementTranscription").mockRejectedValue(new Error("内部测试失败"));
    await act(async () => test.hook.result.current.generatePreview()); expect(test.nav.setActiveStage).not.toHaveBeenCalled(); expect(test.session.setSelected).not.toHaveBeenCalled(); expect(test.head.snapshot.candidates).toHaveLength(1);
    await act(async () => test.hook.result.current.generatePreview()); expect(run).toHaveBeenCalledTimes(2); expect(test.hook.result.current.modelRunning).toBe(false);
  });
  it("纯文字完成标注后不调用构件任务", async () => {
    const test = await setup(); const recognize = vi.spyOn(modelRuns, "runComponentRecognition");
    vi.spyOn(modelRuns, "runMeasurementTranscription").mockResolvedValue({ head: test.head, candidate: test.candidate, run: null! });
    await act(async () => test.hook.result.current.generatePreview()); expect(recognize).not.toHaveBeenCalled();
  });
  it("图像串行执行两任务，第二任务取得前一步最新项目版本", async () => {
    const test = await setup(true, true); let firstHead = test.head;
    vi.spyOn(modelRuns, "runMeasurementTranscription").mockImplementation(async (head) => { const result = await addDimensionCandidate(head); firstHead = result.head; return { ...result, run: null! }; });
    const recognize = vi.spyOn(modelRuns, "runComponentRecognition").mockImplementation(async (head) => ({ ...await addComponentCandidate(head), run: null! }));
    await act(async () => test.hook.result.current.generatePreview());
    expect(recognize).toHaveBeenCalledWith(firstHead, expect.any(String), test.session.selectedModelEvidenceIds, expect.any(Function));
    expect(test.notices.setNotice).toHaveBeenLastCalledWith(expect.stringMatching(/标注提取完成.*构件提取完成/));
    const latest = vi.mocked(test.session.setSelected).mock.calls.at(-1)![0] as ProjectHead;
    expect(latest.snapshot.candidates).toHaveLength(3); expect(test.nav.setActiveStage).toHaveBeenCalledWith("preview");
  });
  it.each(["标注", "构件"])("%s 失败仍保存另一步结果，并逐步报告", async (failed) => {
    const test = await setup(true, true);
    const measurement = vi.spyOn(modelRuns, "runMeasurementTranscription").mockImplementation(async (head) => ({ ...await addDimensionCandidate(head), run: null! }));
    const recognize = vi.spyOn(modelRuns, "runComponentRecognition").mockImplementation(async (head) => ({ ...await addComponentCandidate(head), run: null! }));
    if (failed === "标注") measurement.mockRejectedValue(new Error("内部标注失败")); else recognize.mockRejectedValue(new Error("内部构件失败"));
    await act(async () => test.hook.result.current.generatePreview());
    expect(measurement).toHaveBeenCalledOnce(); expect(recognize).toHaveBeenCalledOnce(); expect(test.nav.setActiveStage).toHaveBeenCalledWith("preview");
    const latest = vi.mocked(test.session.setSelected).mock.calls.at(-1)![0] as ProjectHead;
    expect(latest.snapshot.candidates).toHaveLength(2); expect(latest.snapshot.candidates[0]!.id).toBe(test.candidate.id);
    expect(test.notices.setNotice).toHaveBeenLastCalledWith(expect.stringContaining(failed + "提取失败"));
    expect(test.notices.setError).toHaveBeenLastCalledWith(expect.objectContaining({ summaryZh: expect.stringContaining("未全部完成") }));
  });
  it("服务取消标注后不启动后一步构件任务", async () => {
    const test = await setup(true, true); const recognize = vi.spyOn(modelRuns, "runComponentRecognition");
    vi.spyOn(modelRuns, "runMeasurementTranscription").mockRejectedValue(new Error("MODEL_RUN_CANCELLED"));
    await act(async () => test.hook.result.current.generatePreview()); expect(recognize).not.toHaveBeenCalled();
    expect(test.notices.setNotice).toHaveBeenLastCalledWith(expect.stringMatching(/标注提取已取消.*构件提取未执行/));
  });
  it.each(["标注失败", "构件失败", "标注取消"])("服务返回 %s 回执时按终态报告并保留已有结果", async (terminal) => {
    const test = await setup(true, true);
    const priorRun = (await projectRepository.getProjectModelRuns(test.head.projectId))[0]!;
    const returned = { head: test.head, candidate: null, run: { ...priorRun, status: terminal.endsWith("取消") ? "cancelled" as const : "failed" as const } };
    const measurement = vi.spyOn(modelRuns, "runMeasurementTranscription").mockImplementation(async (head) => ({ ...await addDimensionCandidate(head), run: null! }));
    const recognize = vi.spyOn(modelRuns, "runComponentRecognition").mockImplementation(async (head) => ({ ...await addComponentCandidate(head), run: null! }));
    if (terminal.startsWith("标注")) measurement.mockResolvedValue(returned);
    else recognize.mockImplementation(async (head) => ({ ...returned, head }));
    await act(async () => test.hook.result.current.generatePreview());
    expect(test.session.setProjectModelRuns).toHaveBeenCalled();
    if (terminal.endsWith("取消")) {
      expect(recognize).not.toHaveBeenCalled();
      expect(test.notices.setNotice).toHaveBeenLastCalledWith(expect.stringMatching(/标注提取已取消.*构件提取未执行/));
    } else {
      expect(measurement).toHaveBeenCalledOnce(); expect(recognize).toHaveBeenCalledOnce();
      expect(test.nav.setActiveStage).toHaveBeenCalledWith("preview");
      expect(test.notices.setNotice).toHaveBeenLastCalledWith(expect.stringContaining(terminal.slice(0, 2) + "提取失败"));
      expect(test.notices.setError).toHaveBeenLastCalledWith(expect.objectContaining({ summaryZh: expect.stringContaining("运行记录已保留") }));
    }
  });
});
