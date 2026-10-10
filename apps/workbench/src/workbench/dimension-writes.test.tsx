import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dimensionFixture } from "../test/dimension-fixture";
import { projectCommands, projectRepository } from "../workbench";
import { useRecordWrites } from "./useRecordWrites";
import type { ProjectSession } from "./useProjectSession";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const drafts = [{ rowIndex: 0, disposition: "adopt" as const, name: "总宽", valueMm: "6000", checked: true, reason: "" }];
async function setup(refresh = vi.fn().mockResolvedValue(undefined)) {
  const context = await dimensionFixture();
  const notices = { error: null, notice: null, setError: vi.fn(), setNotice: vi.fn() };
  const setSelected = vi.fn();
  const session = { selected: context.head, confirmedTask: null, setSelected, loadProject: vi.fn(), refresh } as unknown as ProjectSession;
  return { ...context, notices, setSelected, ...renderHook(() => useRecordWrites({ session, notices })) };
}
describe("尺寸写入反馈", () => {
  it("写入失败返回 false，不显示保存成功", async () => {
    const test = await setup();
    vi.spyOn(projectCommands, "execute").mockRejectedValueOnce(new Error("WRITE_FAILED"));
    let ok = true;
    await act(async () => { ok = await test.result.current.confirmTranscribedDimensions(test.candidate, drafts); });
    expect(ok).toBe(false);
    expect(test.notices.setNotice).not.toHaveBeenCalledWith(expect.any(String));
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts).toEqual([]);
  });
  it("读回失败仍报告已保存，不返回可重复提交的失败结果", async () => {
    const test = await setup();
    vi.spyOn(projectRepository, "getProjectHead").mockRejectedValueOnce(new Error("READ_FAILED"));
    let ok = false;
    await act(async () => { ok = await test.result.current.confirmTranscribedDimensions(test.candidate, drafts); });
    expect(ok).toBe(true);
    expect(test.notices.setNotice).toHaveBeenCalledWith("尺寸处置已保存，采用值保持资料转写来源。");
    expect(test.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts).toHaveLength(1);
  });
  it("列表刷新失败仍保留已保存的项目头并说明刷新问题", async () => {
    const test = await setup(vi.fn().mockRejectedValue(new Error("REFRESH_FAILED")));
    let ok = false;
    await act(async () => { ok = await test.result.current.confirmTranscribedDimensions(test.candidate, drafts); });
    expect(ok).toBe(true);
    expect(test.setSelected).toHaveBeenCalledOnce();
    expect(test.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
  });
});

