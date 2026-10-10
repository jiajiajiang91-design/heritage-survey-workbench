import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewReview } from "./PreviewReview";
import { buildPreviewReadModel } from "../preview-read-model";
import { dimensionFixture } from "../test/dimension-fixture";
import { projectRepository } from "../workbench";
import type { EvidencePane } from "../workbench/useEvidencePane";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const { head } = await dimensionFixture(); const id = head.snapshot.evidences[0]!.id;
  head.snapshot.parseRecords[0]!.readability = "readable"; head.snapshot.parseRecords[0]!.readableAs = "image";
  const candidate = head.snapshot.candidates[0]!; if (candidate.structured?.kind !== "measurementTranscription") throw new Error("test");
  candidate.structured.dimensions[0]!.region = { x: .1, y: .2, width: .3, height: .1 };
  const model = buildPreviewReadModel(head.snapshot, (await projectRepository.getProjectAssets(head.projectId)).map((item) => item.record));
  const pane: EvidencePane = { activeEvidenceId: id, activeEvidenceTitle: "内部测试尺寸.txt", setActiveEvidenceId: vi.fn(), evidencePreview: { evidenceId: id, url: "test-image", mimeType: "image/png", fileName: "内部图.png" }, imageSelection: null, setImageSelection: vi.fn(), downloadEvidence: vi.fn() };
  const props = { snapshot: head.snapshot, model, pane, loading: false, error: null, onReview: vi.fn(), onReturn: vi.fn() };
  return { props, view: render(<PreviewReview {...props} />) };
}
describe("预览核对页面", () => {
  it("候选框保持归一化位置，选择条目关联来源，核对复用外部回调", async () => {
    const { props, view } = await setup(); const rect = view.container.querySelector<HTMLElement>(".evidence-marquee__rect")!;
    expect(rect.style.left).toBe("10%"); expect(rect.style.top).toBe("20%"); expect(rect.style.width).toBe("30%");
    fireEvent.click(screen.getByRole("button", { name: "查看条目 2：总深" }));
    expect(props.pane.setActiveEvidenceId).toHaveBeenCalledWith(props.model.rows[1]!.evidenceId); expect(props.pane.setImageSelection).toHaveBeenCalledWith(null);
    expect(view.container.querySelector(".evidence-marquee__rect")).toBeNull(); expect(screen.getByText("测试记录第 2 行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "核对或修正此标注" })); expect(props.onReview).toHaveBeenCalledWith(props.model.rows[1]);
    fireEvent.change(screen.getByLabelText("筛选核对状态"), { target: { value: "adopted" } }); expect(screen.getByText("此状态下没有条目。")).toBeInTheDocument();
  });
  it("下载输出包含实际最新值和来源，筛选不裁减导出", async () => {
    const { props, view } = await setup(); const blobs: Blob[] = []; const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL { static override createObjectURL(blob: Blob) { blobs.push(blob); return "blob:test"; } static override revokeObjectURL() {} });
    props.model.rows[0] = { ...props.model.rows[0]!, status: "corrected", adoptedMm: 6100 };
    view.rerender(<PreviewReview {...props} />);
    fireEvent.change(screen.getByLabelText("筛选核对状态"), { target: { value: "corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "导出来源说明 JSON" }));
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]!); });
    const output = JSON.parse(text); expect(output.unit).toBe("mm"); expect(output.rows).toHaveLength(3); expect(output.rows[0]).toMatchObject({ adoptedMm: 6100, candidateMm: "6000", originalText: "6000", sourceHash: props.model.rows[0]!.sourceHash });
    expect(screen.getByRole("link", { name: "保存导出文件" })).toHaveAttribute("download", props.snapshot.project.name + ".预览核对.json");
    expect(screen.getByLabelText("导出内容")).toHaveValue(text); click.mockRestore();
  });
  it("异步切换原件期间不把新条目框叠加到旧图片", async () => {
    const { props, view } = await setup(); props.pane.evidencePreview = { ...props.pane.evidencePreview!, evidenceId: crypto.randomUUID() };
    view.rerender(<PreviewReview {...props} />);
    expect(view.container.querySelector(".evidence-marquee__rect")).toBeNull(); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("缺元数据时给出原因且禁止导出，整体不可核对的条目保持只读", async () => {
    const { props, view } = await setup(); props.model.rows[0] = { ...props.model.rows[0]!, status: "inactive", reviewable: false };
    view.rerender(<PreviewReview {...props} error="来源文件信息读取失败，请重新进入项目。" />);
    expect(screen.getByRole("button", { name: "核对或修正此标注" })).toBeDisabled(); expect(screen.getByRole("button", { name: "导出核对清单 CSV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "返回资料清单" })); expect(props.onReturn).toHaveBeenCalledOnce();
  });
});
