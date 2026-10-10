import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DimensionCandidateReview } from "./DimensionCandidateReview";
import { dimensionFixture } from "../test/dimension-fixture";
import { buildDimensionReviewFacts, type DimensionReviewDraft } from "../dimension-review";
import { localActorId } from "../workbench";
afterEach(cleanup);
async function setup(submit = vi.fn().mockResolvedValue(true)) {
  const context = await dimensionFixture();
  const show = vi.fn();
  const props = { candidate: context.candidate, snapshot: context.head.snapshot, evidenceTitle: () => "内部测试尺寸.txt", onShowEvidence: show, onSubmit: submit };
  const view = render(<DimensionCandidateReview {...props} />);
  return { ...context, props, view, show, submit };
}
function choose(row: number, disposition = "adopt") { fireEvent.change(screen.getByLabelText("第 " + row + " 条处置"), { target: { value: disposition } }); }
function checked(row: number) { fireEvent.click(screen.getByLabelText("已核对第 " + row + " 条原资料")); }
describe("尺寸候选核对表单", () => {
  it("默认全部暂不处理，资料可定位，保存只包含用户核对的条目", async () => {
    const test = await setup();
    expect(screen.getAllByRole("combobox").filter((field) => field.getAttribute("aria-label")?.endsWith("处置")).every((field) => (field as HTMLSelectElement).value === "pending")).toBe(true);
    expect(screen.getByRole("button", { name: "保存所选尺寸处置" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "查看资料：内部测试尺寸.txt" })[0]!);
    expect(test.show).toHaveBeenCalledWith(test.candidate.evidenceRefs[0], 0);
    choose(2); checked(2);
    fireEvent.click(screen.getByRole("button", { name: "保存所选尺寸处置" }));
    await waitFor(() => expect(test.submit).toHaveBeenCalledOnce());
    expect(test.submit.mock.calls[0]![1]).toEqual([{ rowIndex: 1, quantityKind: "length", disposition: "adopt", name: "总深", valueMm: "4200", checked: true, reason: "" }]);
  });
  it("缺数值不会自动填入，修正后必须重新核对并说明", async () => {
    const test = await setup();
    choose(3);
    expect(screen.getByLabelText("第 3 条数值")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("第 3 条数值"), { target: { value: "3000" } });
    checked(3);
    fireEvent.click(screen.getByRole("button", { name: "保存所选尺寸处置" }));
    expect(await screen.findByText("待核实、修正或同名异值的条目需要填写核对说明。")).toBeInTheDocument();
    expect(test.submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("第 3 条说明"), { target: { value: "人工测试说明" } });
    fireEvent.change(screen.getByLabelText("第 3 条数值"), { target: { value: "3100" } });
    expect(screen.getByLabelText("已核对第 3 条原资料")).not.toBeChecked();
    checked(3);
    fireEvent.click(screen.getByRole("button", { name: "保存所选尺寸处置" }));
    await waitFor(() => expect(test.submit).toHaveBeenCalledOnce());
  });
  it("失败保留草稿，保存中禁用重复提交，完成后允许重试", async () => {
    let resolve!: (value: boolean) => void;
    const submit = vi.fn().mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; })).mockResolvedValue(true);
    await setup(submit); choose(1); checked(1);
    const button = screen.getByRole("button", { name: "保存所选尺寸处置" });
    fireEvent.click(button); fireEvent.submit(screen.getByRole("form", { name: "尺寸候选核对" }));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("第 1 条数值")).toBeDisabled();
    await act(async () => resolve(false));
    expect(screen.getByText("保存未成功。草稿已保留，可修正后重试。")).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 条数值")).toHaveValue("6000");
    expect(screen.getByLabelText("已核对第 1 条原资料")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存所选尺寸处置" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  });
  it("驳回必须有理由，已处理行可重新核对", async () => {
    const test = await setup();
    choose(3, "reject");
    fireEvent.click(screen.getByRole("button", { name: "保存所选尺寸处置" }));
    expect(await screen.findByText("请填写驳回原因。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("第 3 条说明"), { target: { value: "原文不可辨认" } });
    const draft: DimensionReviewDraft = { rowIndex: 2, disposition: "reject", name: "层高", valueMm: "", checked: false, reason: "原文不可辨认" };
    const facts = buildDimensionReviewFacts(test.head, test.candidate, [draft], localActorId(), crypto.randomUUID());
    fireEvent.click(screen.getByRole("button", { name: "保存所选尺寸处置" }));
    await waitFor(() => expect(test.submit).toHaveBeenCalledOnce());
    test.view.rerender(<DimensionCandidateReview {...test.props} snapshot={{ ...test.head.snapshot, facts }} />);
    expect(screen.getByText("已驳回")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新核对第 3 条" }));
    expect(screen.getByLabelText("第 3 条处置")).toHaveValue("pending");
  });
});


it("候选内容变化时保留原草稿并阻止按新候选行号提交", async () => {
  const test = await setup();
  choose(1);
  fireEvent.change(screen.getByLabelText("第 1 条数值"), { target: { value: "6300" } });
  test.view.rerender(<DimensionCandidateReview {...test.props} candidate={{ ...test.candidate, contentText: "另一版本的候选" }} />);
  expect(screen.getByLabelText("第 1 条数值")).toHaveValue("6300");
  expect(screen.getByLabelText("第 1 条数值")).toBeDisabled();
  expect(screen.getByText("候选内容已变化，原草稿已保留，请重新打开本页核对最新内容。")).toBeInTheDocument();
});
