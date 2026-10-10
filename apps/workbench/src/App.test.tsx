import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App, LENGTH_INPUT_STEP } from "./App";

afterEach(cleanup);

// 演示项目装载在本用例里注入空实现。它是组件挂载后自行发起的异步写入，
// 测试无法等待，完成时的重渲染会把已取到的节点摘出文档，断言随机失败。
// 装载本身的覆盖在 demo-library-loader.test.ts。
const noDemoBootstrap = async () => null;

describe("App", () => {
  it("建立项目后显示当前建筑和版本", async () => {
    render(<App bootstrapDemo={noDemoBootstrap} />);
    expect(screen.getByRole("heading", { name: /古建保护/ })).toBeInTheDocument();
    expect(screen.getByText("项目与资料保存在本机。AI 处理按本次选择发送资料。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建制作任务" }));
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "山门保护记录" } });
    fireEvent.change(screen.getByLabelText("建筑名称"), { target: { value: "山门" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    const stageNav = await screen.findByRole("navigation", { name: "任务进度" });
    expect(screen.getByRole("heading", { name: "山门" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByText("山门保护记录").length).toBeGreaterThan(0);

    // 新建草稿进入设置，主导航保留可读名称。
    expect(within(stageNav).getByRole("button", { name: /任务设置/ })).toHaveAttribute("aria-current", "step");
    expect(await screen.findByText("本次制作任务")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置图纸要求" }));
    fireEvent.change(screen.getByLabelText("图纸标题"), { target: { value: "山门代理成果图" } });
    fireEvent.change(screen.getByLabelText("修订标记"), { target: { value: "P1" } });
    fireEvent.change(screen.getByLabelText("需要出图的构件类型（每行一项）"), { target: { value: "wall" } });
    fireEvent.change(screen.getByLabelText("图号", { exact: true }), { target: { value: "P-01" } });
    fireEvent.change(screen.getByLabelText("图幅名称", { exact: true }), { target: { value: "首层图纸" } });
    fireEvent.change(screen.getByLabelText("视图名称", { exact: true }), { target: { value: "首层平面" } });
    fireEvent.change(screen.getByLabelText("视图编号", { exact: true }), { target: { value: "平-01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    expect(await screen.findByText("本次制作任务")).toBeInTheDocument();
    expect(await screen.findByText("任务要求已保存。旧任务与成果保留，新成果需重新生成。")).toBeInTheDocument();

    // 问题处理在辅助入口中，能力仍可访问。
    fireEvent.click(within(screen.getByRole("navigation", { name: "辅助工作" })).getByRole("button", { name: "问题队列" }));
    expect(await screen.findByText("待处理问题")).toBeInTheDocument();

    fireEvent.click(within(stageNav).getByRole("button", { name: /检查与导出/ }));
    fireEvent.click(screen.getByRole("button", { name: "成果导出" }));
    fireEvent.click(screen.getByText("项目记录与恢复"));
    expect(screen.getByRole("button", { name: "检验导出与恢复" })).toBeInTheDocument();
  });

  it("长度输入接受图纸换算后的毫米小数", async () => {
    expect(LENGTH_INPUT_STEP).toBe("any");
  });
});
