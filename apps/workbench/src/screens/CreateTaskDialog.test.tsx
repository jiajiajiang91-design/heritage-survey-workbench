import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateTaskDialog } from "./CreateTaskDialog";
afterEach(cleanup);
const fill = () => { fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "山门现状测绘" } }); fireEvent.change(screen.getByLabelText("建筑名称"), { target: { value: "山门" } }); };
describe("单页创建任务", () => {
  it("错误就近显示，目标动态说明保持文件并可移除，提交基本设置和资料", async () => {
    const save = vi.fn().mockResolvedValue(true); render(<CreateTaskDialog onSubmit={save} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存任务并准备资料" }));
    expect(await screen.findByText("请填写 1 至 200 字的任务名称。")).toBeInTheDocument(); expect(save).not.toHaveBeenCalled(); fill();
    fireEvent.change(screen.getByLabelText("添加必需资料"), { target: { files: [new File(["source"], "原始图纸.txt")] } });
    fireEvent.click(screen.getByRole("checkbox", { name: "指定剖面" }));
    expect(screen.getByText(/指定剖面需要剖切位置与构造记录/)).toBeInTheDocument(); expect(screen.getByText("原始图纸.txt")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("添加建议资料"), { target: { files: [new File(["source"], "照片.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "移除：照片.txt" })); expect(screen.queryByText("照片.txt")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("输出单位"), { target: { value: "cm" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务并准备资料" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].production.outputUnit).toBe("cm"); expect(save.mock.calls[0]![1][0].level).toBe("required"); expect(save.mock.calls[0]![2]).toBe("evidence");
  });
  it("重复操作只提交一次，失败保留字段和文件，离开可继续编辑或保存后返回", async () => {
    let resolve: (ok: boolean) => void = () => {}; const save = vi.fn((..._args: unknown[]) => new Promise<boolean>((done) => { resolve = done; })); const close = vi.fn();
    render(<CreateTaskDialog onSubmit={save} onClose={close} />); fill();
    fireEvent.change(screen.getByLabelText("添加额外补充资料"), { target: { files: [new File(["detail"], "节点.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => resolve(false)); expect(screen.getByText(/任务保存未成功/)).toBeInTheDocument(); expect(screen.getByLabelText("任务名称")).toHaveValue("山门现状测绘"); expect(screen.getByText("节点.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" })); fireEvent.click(screen.getByRole("button", { name: "保存后返回" })); expect(save.mock.calls[1]![2]).toBe("list");
    await act(async () => resolve(true));
  });
  it("没有目标不能提交，空白取消直接关闭，创建不要求图纸设置", async () => {
    const save=vi.fn(); const close=vi.fn(); render(<CreateTaskDialog onSubmit={save} onClose={close} />);
    expect(screen.queryByLabelText("图纸标题")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(close).toHaveBeenCalledTimes(1);
    fill(); for(const name of ["主体模型", "首层平面"]) fireEvent.click(screen.getByRole("checkbox", { name }));
    fireEvent.click(screen.getByRole("button", { name: "保存任务并准备资料" })); expect(await screen.findByText("请选择至少一项目标成果。")).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
  });
});
