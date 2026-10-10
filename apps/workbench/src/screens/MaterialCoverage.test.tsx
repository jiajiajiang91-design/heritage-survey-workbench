import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaterialCoverage, MaterialCoverageEditor } from "./MaterialCoverage";
import { coverageEntries, commitMaterialCoverage } from "../material-coverage";
import { componentFixture } from "../test/component-fixture";
import { localActorId, projectCommands, projectRepository } from "../workbench";
import { emptyProductionTask, taskFromProduction } from "../production-task";
afterEach(cleanup);
describe("资料覆盖操作", () => {
  it("先核对原件再登记，空位置保留输入；真实保存、重开及清空", async () => {
    const test = await componentFixture(); let head = test.head; const evidenceId = head.snapshot.evidences[0]!.id; const onOpen = vi.fn();
    const onSave = vi.fn(async (id, entries) => { head = await commitMaterialCoverage({ head, evidenceId: id, entries, actorId: localActorId(), commands: projectCommands, repository: projectRepository }); return true; });
    const view = render(<MaterialCoverageEditor snapshot={head.snapshot} evidenceId={evidenceId} onSave={onSave} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "登记资料覆盖" })); expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("覆盖 平面范围")); fireEvent.click(screen.getByRole("button", { name: "保存资料覆盖" }));
    expect(screen.getByRole("alert").textContent).toContain("来源位置"); expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("平面范围来源位置"), { target: { value: "内部图上方首层平面" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存资料覆盖" })));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull()); view.rerender(<MaterialCoverageEditor snapshot={head.snapshot} evidenceId={evidenceId} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "登记资料覆盖" })); expect((screen.getByLabelText("平面范围来源位置") as HTMLInputElement).value).toBe("内部图上方首层平面");
    fireEvent.click(screen.getByLabelText("覆盖 平面范围")); await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存资料覆盖" })));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(coverageEntries(head.snapshot, evidenceId)).toEqual([]);
  });
  it("保存失败保留输入，汇总可以定位原件", async () => {
    const test = await componentFixture(); const evidenceId = test.head.snapshot.evidences[0]!.id;
    const view = render(<MaterialCoverageEditor snapshot={test.head.snapshot} evidenceId={evidenceId} onSave={async () => false} />);
    fireEvent.click(screen.getByRole("button", { name: "登记资料覆盖" })); fireEvent.click(screen.getByLabelText("覆盖 平面范围"));
    fireEvent.change(screen.getByLabelText("平面范围来源位置"), { target: { value: "内部位置" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存资料覆盖" })));
    expect(screen.getByRole("alert").textContent).toContain("保留输入"); expect((screen.getByLabelText("平面范围来源位置") as HTMLInputElement).value).toBe("内部位置");
    const head = await commitMaterialCoverage({ head: test.head, evidenceId, entries: [{ purpose: "plan", sourceLocation: "内部位置" }], actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    head.snapshot.taskDefinitions.push(taskFromProduction({ ...emptyProductionTask(), taskName: "内部覆盖", buildingName: "内部", targets: ["floorPlan"] }, head.snapshot.buildings[0]!.id, localActorId()));
    const select = vi.fn(); view.rerender(<MaterialCoverage snapshot={head.snapshot} onSelect={select} />);
    expect(screen.getByText("待补充依据", { exact: false })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: head.snapshot.evidences[0]!.title })); expect(select).toHaveBeenCalledWith(evidenceId);
  });
});
