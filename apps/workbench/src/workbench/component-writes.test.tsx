import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { componentFixture } from "../test/component-fixture";
import { projectCommands, projectRepository } from "../workbench";
import { useRecordWrites } from "./useRecordWrites";
import { componentDraft } from "../component-input";
import type { ProjectSession } from "./useProjectSession";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function setup(refresh = vi.fn().mockResolvedValue(undefined)) {
  const context = await componentFixture();
  const notices = { error: null, notice: null, setError: vi.fn(), setNotice: vi.fn() };
  const setSelected = vi.fn();
  const session = { selected: context.head, confirmedTask: null, setSelected, loadProject: vi.fn(), refresh } as unknown as ProjectSession;
  return { ...context, notices, setSelected, ...renderHook(() => useRecordWrites({ session, notices })) };
}
describe("构件写入反馈", () => {
  it("写入失败返回 false，保留项目原记录", async () => {
    const test = await setup();
    vi.spyOn(projectCommands, "execute").mockRejectedValueOnce(new Error("WRITE_FAILED"));
    let ok = true;
    await act(async () => { ok = await test.result.current.confirmGeometryFacts({ components: [test.component], interfaces: [] }); });
    expect(ok).toBe(false);
    expect(test.notices.setNotice).not.toHaveBeenCalledWith(expect.any(String));
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts).toEqual(test.head.snapshot.facts);
  });
  it("读回失败报告已保存，避免误导再次提交", async () => {
    const test = await setup();
    vi.spyOn(projectRepository, "getProjectHead").mockRejectedValueOnce(new Error("READ_FAILED"));
    let ok = false;
    await act(async () => { ok = await test.result.current.confirmGeometryFacts({ components: [test.component], interfaces: [] }); });
    expect(ok).toBe(true);
    expect(test.notices.setNotice).toHaveBeenCalledWith("构件输入已保存。重新生成模型和图纸后使用新参数，旧成果保留。");
    expect(test.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts).toHaveLength(test.head.snapshot.facts.length + 1);
  });
  it("刷新失败仍保留已保存项目，尺寸引用进入真实仓储", async () => {
    const test = await setup(vi.fn().mockRejectedValue(new Error("REFRESH_FAILED")));
    const component = { ...test.component, dimensionBindings: [{ field: "sizeX" as const, sourceFactRef: test.dimension.id }] };
    let ok = false;
    await act(async () => { ok = await test.result.current.confirmGeometryFacts({ components: [component], interfaces: [] }); });
    expect(ok).toBe(true); expect(test.setSelected).toHaveBeenCalledOnce();
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts.at(-1)!.value).toEqual(component);
    expect(test.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
  });
  it("核对草稿经真实入口一次保存尺寸与构件，不产生几何成果", async () => {
    const test = await setup();
    const draft = componentDraft(test.component);
    draft.candidateBindings = { sizeX: { candidateId: test.candidate.id, rowIndex: 1 } };
    draft.lengths.sizeX = "4200";
    const execute = vi.spyOn(projectCommands, "execute");
    let ok = false;
    await act(async () => { ok = await test.result.current.confirmDraftGeometryComponent(draft); });
    expect(ok).toBe(true); expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0]).toMatchObject({ commandType: "CommitFacts" });
    const saved = (await projectRepository.getProjectHead(test.head.projectId))!;
    const component = saved.snapshot.facts.at(-1)!.value as { dimensionBindings: { sourceFactRef: string }[] };
    expect(saved.snapshot.facts).toHaveLength(test.head.snapshot.facts.length + 2);
    expect(component.dimensionBindings[0]!.sourceFactRef).toBe(saved.snapshot.facts.at(-2)!.id);
    expect(saved.snapshot.geometryRevisions).toEqual(test.head.snapshot.geometryRevisions);
    expect(await projectRepository.getProjectArtifacts(test.head.projectId)).toEqual([]);
  });
  it("核对草稿失败返回false且尺寸与构件均未写入", async () => {
    const test = await setup();
    const draft = componentDraft(test.component);
    draft.candidateBindings = { sizeX: { candidateId: test.candidate.id, rowIndex: 1 } };
    draft.lengths.sizeX = "4200";
    vi.spyOn(projectCommands, "execute").mockRejectedValueOnce(new Error("WRITE_FAILED"));
    let ok = true;
    await act(async () => { ok = await test.result.current.confirmDraftGeometryComponent(draft); });
    expect(ok).toBe(false); expect(test.setSelected).not.toHaveBeenCalled();
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts).toEqual(test.head.snapshot.facts);
  });
  it("核对草稿已提交而读回失败时仍报告已保存，避免重复采用", async () => {
    const test = await setup();
    const draft = componentDraft(test.component);
    draft.candidateBindings = { sizeX: { candidateId: test.candidate.id, rowIndex: 1 } };
    draft.lengths.sizeX = "4200";
    vi.spyOn(projectRepository, "getProjectHead").mockRejectedValueOnce(new Error("READ_FAILED"));
    let ok = false;
    await act(async () => { ok = await test.result.current.confirmDraftGeometryComponent(draft); });
    expect(ok).toBe(true);
    expect(test.notices.setNotice).toHaveBeenCalledWith("尺寸核对与构件输入已保存，可继续生成模型和图纸。");
    expect(test.notices.setError.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
    expect((await projectRepository.getProjectHead(test.head.projectId))!.snapshot.facts).toHaveLength(test.head.snapshot.facts.length + 2);
  });
});
