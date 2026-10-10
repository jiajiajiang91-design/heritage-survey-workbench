import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskSetupForm } from "./TaskSetupForm";
import { SheetStyle } from "./SheetStyle";
import { sampleTask, sampleReferences } from "../test/task-fixture";

afterEach(cleanup);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const props = { task: sampleTask, references: sampleReferences, roleOptions: [{ value: "wall", label: "墙" }] };

describe("任务与出图表单", () => {
  it("空项目用普通字段建立图幅、视图与图签", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<TaskSetupForm task={null} references={{ components: [], evidences: [] }} roleOptions={[]} onSubmit={submit} />);
    change("成果目录（每行一项）", "平面 DXF\n平面 PDF");
    change("图纸标题", "建筑首层");
    change("需要出图的构件类型（每行一项）", "wall\n");
    change("图号", "A-01");
    change("图幅名称", "首层图纸");
    change("视图名称", "首层平面");
    change("视图编号", "平-01");
    change("比例分母（1 : N）", "50");
    fireEvent.click(screen.getByRole("button", { name: "确认任务要求，开始制作" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const values = submit.mock.calls[0]![0];
    expect(values.artifactRequirements.titleZh).toBe("建筑首层");
    expect(values.artifactRequirements.geometryTargetRoles).toEqual(["wall"]);
    expect(values.artifactRequirements.sheets[0].pageMm).toEqual([420, 297]);
    expect(values.artifactRequirements.views[0]).toMatchObject({ displayLabelZh: "首层平面", scaleDenominator: 50, sheetKey: values.artifactRequirements.sheets[0].key });
    expect(screen.queryByLabelText("图幅设置")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("视图设置")).not.toBeInTheDocument();
  });
  it("失败保留草稿，保存期间禁用重复提交和取消，恢复后可以重试", async () => {
    let finish: (value: boolean) => void = () => {};
    const submit = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; })).mockResolvedValue(true);
    const cancel = vi.fn();
    render(<TaskSetupForm {...props} onSubmit={submit} onCancel={cancel} />);
    change("比例分母（1 : N）", "50");
    const save = screen.getByRole("button", { name: "保存任务要求" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消修改" })).toBeDisabled();
    await act(async () => finish(false));
    expect(screen.getByText("保存未成功。草稿已保留，请查看错误原因并重试。")).toBeInTheDocument();
    expect(screen.getByLabelText("比例分母（1 : N）")).toHaveValue(50);
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]![0].artifactRequirements.views[0].sectionPlane.offsetMm).toBe(1200.25);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("新增和移除不会产生悬空图幅引用", () => {
    render(<TaskSetupForm {...props} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "移除图幅" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "新增图幅" }));
    const names = screen.getAllByLabelText("图幅名称", { exact: true });
    fireEvent.change(names[1]!, { target: { value: "新图幅" } });
    const select = screen.getByLabelText("所属图幅") as HTMLSelectElement;
    const newKey = within(select).getByRole("option", { name: "新图幅" }).getAttribute("value");
    fireEvent.change(select, { target: { value: newKey } });
    const remove = screen.getAllByRole("button", { name: "移除图幅" });
    expect(remove[0]).not.toBeDisabled();
    expect(remove[1]).toBeDisabled();
    fireEvent.click(remove[0]!);
    expect(screen.getAllByLabelText("图幅名称", { exact: true })).toHaveLength(1);
    expect(screen.getByLabelText("所属图幅")).toHaveValue(newKey);
    fireEvent.click(screen.getByRole("button", { name: "新增视图" }));
    expect(screen.getAllByLabelText("视图名称", { exact: true })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "移除视图" })[1]!);
    expect(screen.getAllByLabelText("视图名称", { exact: true })).toHaveLength(1);
  });
  it("非法比例显示字段错误且不提交，修正后保留其他参数", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<TaskSetupForm {...props} onSubmit={submit} />);
    change("比例分母（1 : N）", "0");
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("比例分母（1 : N）")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("比例分母须为正整数");
    change("比例分母（1 : N）", "50");
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0].artifactRequirements.views[0].cropBoundsMm).toEqual([-20.5, -30.25, 15000, 20000]);
  });
  it("明确修改朝向、剖切、裁切与依据，保存值对应所见字段", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<TaskSetupForm {...props} onSubmit={submit} />);
    change("图种", "detail");
    change("观察方向", "1");
    change("剖切偏移（mm）", "2300.5");
    change("剖切法向 · Y", "-1");
    change("剖切法向 · Z", "0");
    change("裁切范围（视图坐标 mm） · 向右最大值", "2500.25");
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0].artifactRequirements.views[0]).toMatchObject({
      kind: "detail", direction: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1],
      sectionPlane: { normal: [0, -1, 0], offsetMm: 2300.5 }, cropBoundsMm: [-20.5, -30.25, 2500.25, 20000],
      targetStableKeys: ["wall-1"], sourceEvidenceRefs: ["evidence-1"],
    });
  });
  it("缺失引用保留并提示，明确移除后才可保存", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<TaskSetupForm {...props} references={{ components: [], evidences: [] }} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getAllByText("当前项目中缺失的引用 1")).toHaveLength(2);
    const buttons = screen.getAllByRole("button", { name: "移除" });
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0].artifactRequirements.views[0].sourceEvidenceRefs).toEqual([]);
  });
  it("出图页面复用要求表单，失败不退出，取消不提交，成功后退出", async () => {
    const submit = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<SheetStyle {...props} onSubmitTask={submit} previews={[]} canGenerate generating={false} onGenerate={vi.fn()} onEditTask={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "修改出图要求" }));
    expect(screen.queryByLabelText("任务名称")).not.toBeInTheDocument();
    change("图纸标题", "修改后图签");
    expect(screen.getByLabelText("本次变化")).toHaveTextContent("图纸标题已修改");
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "修改出图要求" }));
    expect(screen.getByLabelText("图纸标题", { exact: true })).toHaveValue("测试建筑");
    change("图纸标题", "修改后图签");
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    expect(await screen.findByText("保存未成功。草稿已保留，请查看错误原因并重试。")).toBeInTheDocument();
    expect(screen.getByLabelText("图纸标题", { exact: true })).toHaveValue("修改后图签");
    fireEvent.click(screen.getByRole("button", { name: "保存任务要求" }));
    expect(await screen.findByRole("button", { name: "修改出图要求" })).toBeInTheDocument();
    expect(submit.mock.calls[1]![0]).toMatchObject({ taskName: sampleTask.name, scope: sampleTask.scope, deliverables: sampleTask.deliverables, regulationRefs: sampleTask.regulationRefs });
  });
  it("当前任务在其他操作中更新时允许取消，禁止旧草稿覆盖", () => {
    const submit = vi.fn(); const cancel = vi.fn();
    const { rerender } = render(<TaskSetupForm {...props} onSubmit={submit} onCancel={cancel} />);
    change("图纸标题", "尚未保存的草稿");
    rerender(<TaskSetupForm {...props} task={{ ...sampleTask, id: "33333333-3333-4333-8333-333333333333" }} onSubmit={submit} onCancel={cancel} />);
    expect(screen.getByLabelText("图纸标题", { exact: true })).toHaveValue("尚未保存的草稿");
    expect(screen.getByRole("button", { name: "保存任务要求" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });
  it("修改任务比例后不能用新比例标注已有预览文件", () => {
    const task = structuredClone(sampleTask);
    task.artifactRequirements!.views[0]!.scaleDenominator = 75;
    const { container } = render(<SheetStyle {...props} task={task} onSubmitTask={vi.fn()} previews={[{ id: "preview-1", kind: "svg", label: "P-01.svg", url: "blob:test-preview" }]} canGenerate generating={false} onGenerate={vi.fn()} onEditTask={vi.fn()} />);
    expect(container.querySelector(".sc-sheet-settings")).toHaveTextContent("1:75");
    expect(container.querySelector(".sc-sheet-preview")).not.toHaveTextContent("1:75");
    expect(screen.getByRole("img", { name: "P-01.svg 图面预览" })).toHaveAttribute("src", "blob:test-preview");
    expect(screen.getByText(/此处显示已生成的文件，修改设置后重新生成才会更新/)).toBeInTheDocument();
  });});


