import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentInputPanel } from "./GeometryComponentEditor";
import { componentCandidateFixture } from "../test/component-candidate-fixture";
import { commitGeometryFacts } from "../geometry-fact-service";
import { localActorId, projectCommands, projectRepository } from "../workbench";
import { componentInputs, type ComponentInput } from "../component-input";
afterEach(cleanup);

describe("候选进入构件制作表单", () => {
  it("沿用候选来源，填写并绑定后真实保存，重命名后仍编辑同一输入", async () => {
    const test = await componentCandidateFixture(); let head = test.head;
    const save = vi.fn(async (value: ComponentInput) => {
      head = (await commitGeometryFacts({ head, values: { components: [value], interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository })).head!;
      return true;
    });
    const show = vi.fn();
    const props = { snapshot: head.snapshot, onSave: save, onShowEvidence: show };
    const view = render(<ComponentInputPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "完善识别构件：内部墙体" }));
    expect(screen.getByLabelText("构件名称")).toHaveValue("内部墙体");
    expect(screen.getByLabelText("构件类型")).toHaveValue("wall");
    expect(screen.getByLabelText("X 坐标")).toHaveValue("");
    expect((screen.getByLabelText("资料位置") as HTMLInputElement).value).toContain("归一化");
    expect(screen.getByRole("checkbox", { name: "内部测试尺寸.txt" })).toBeChecked();
    expect(show).toHaveBeenCalledWith(test.component.evidenceRefs[0]);
    fireEvent.change(screen.getByLabelText("X 向长度来源"), { target: { value: test.dimension.id } });
    expect(screen.getByLabelText("X 向长度（mm）")).toHaveValue("6000");
    for (const [label, value] of [["材料", "测试砖"], ["Y 向长度（mm）", "240"], ["Z 向长度（mm）", "3000"], ["X 坐标", "3000"], ["Y 坐标", "120"], ["Z 坐标", "1500"]]) {
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "保存构件输入" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "构件参数" })).not.toBeInTheDocument());
    view.rerender(<ComponentInputPanel {...props} snapshot={head.snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑识别构件：内部墙体" }));
    const stableKey = componentInputs(head.snapshot)[0]!.stableKey;
    expect(screen.getByLabelText("X 向长度（mm）")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("构件名称"), { target: { value: "人工核对墙体" } });
    fireEvent.click(screen.getByRole("button", { name: "保存构件输入" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("form", { name: "构件参数" })).not.toBeInTheDocument());
    view.rerender(<ComponentInputPanel {...props} snapshot={head.snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑识别构件：人工核对墙体" }));
    expect(screen.getByLabelText("构件名称")).toHaveValue("人工核对墙体");
    expect(screen.getByLabelText("X 向长度来源")).toHaveValue(test.dimension.id);
    expect(componentInputs(head.snapshot)).toHaveLength(1);
    expect(componentInputs(head.snapshot)[0]).toMatchObject({ stableKey, candidateSource: { candidateId: test.recognition.id, rowIndex: 0 } });
  });
  it("预览传入的候选选择打开相应条目，候选失效后明确提示并停止新增", async () => {
    const test = await componentCandidateFixture(); const handled = vi.fn(); const selected = vi.fn();
    const source = { candidateId: test.recognition.id, rowIndex: 1 };
    const props = { snapshot: test.head.snapshot, onSave: vi.fn(), onShowEvidence: vi.fn(), onSelectionHandled: handled, onSelectCandidate: selected };
    const view = render(<ComponentInputPanel {...props} selection={source} />);
    expect(screen.getByLabelText("构件名称")).toHaveValue("内部圆柱");
    expect(selected).toHaveBeenCalledWith(source); expect(handled).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    view.rerender(<ComponentInputPanel {...props} selection={null} />);
    const snapshot = structuredClone(test.head.snapshot);
    snapshot.candidates.find((row) => row.id === test.recognition.id)!.reviewStatus = "rejected";
    view.rerender(<ComponentInputPanel {...props} snapshot={snapshot} selection={source} />);
    expect(screen.queryByRole("form", { name: "构件参数" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("候选或其原件已不可用");
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
