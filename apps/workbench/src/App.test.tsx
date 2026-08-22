import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByText("资料原件保存在本机，不会上传")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "山门保护记录" } });
    fireEvent.change(screen.getByLabelText("建筑名称"), { target: { value: "山门" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并进入项目" }));

    expect(await screen.findByRole("heading", { name: "山门" })).toBeInTheDocument();
    expect(screen.getByText("山门保护记录")).toBeInTheDocument();

    // 导航分两层：左栏是八个任务阶段，中栏页签只在阶段含多个视图时出现。
    // 问题队列属记录现状阶段的第二个视图，因此先进阶段再点页签。
    const stageNav = screen.getByRole("navigation", { name: "任务进度" });
    fireEvent.click(within(stageNav).getByRole("button", { name: /记录现状/ }));
    const viewTabs = screen.getByRole("navigation", { name: "工作区视图" });
    fireEvent.click(within(viewTabs).getByRole("button", { name: "问题队列" }));
    expect(await screen.findByText("问题队列与必要人工节点")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("成果目录（每行一项）"), { target: { value: "平面图" } });
    fireEvent.change(screen.getByLabelText("图纸标题"), { target: { value: "山门代理成果图" } });
    fireEvent.change(screen.getByLabelText("修订标记"), { target: { value: "P1" } });
    fireEvent.change(screen.getByLabelText("需要出图的构件类型（每行一项）"), { target: { value: "wall" } });
    fireEvent.change(screen.getByLabelText("图幅设置"), { target: { value: '[{"key":"sheet","drawingNumber":"P-01","displayLabelZh":"平面","pageMm":[420,297]}]' } });
    fireEvent.change(screen.getByLabelText("视图设置"), { target: { value: '[{"key":"plan","displayLabelZh":"平面","drawingRef":"平-01","kind":"floorPlan","scaleDenominator":50,"sheetKey":"sheet","viewportRectMm":[20,20,380,250],"direction":[0,0,1],"right":[1,0,0],"up":[0,1,0],"targetStableKeys":[],"sourceEvidenceRefs":[]}]' } });
    fireEvent.click(screen.getByRole("button", { name: "确认任务要求，开始整理资料" }));
    expect(await screen.findByText("任务要求已确认")).toBeInTheDocument();

    // 交付归档只有一个视图，没有页签行，从左栏阶段直接进。
    fireEvent.click(within(stageNav).getByRole("button", { name: /交付归档/ }));
    expect(screen.getByRole("button", { name: "检验导出与恢复" })).toBeInTheDocument();
  });

  it("长度输入接受图纸换算后的毫米小数", async () => {
    expect(LENGTH_INPUT_STEP).toBe("any");
  });
});
