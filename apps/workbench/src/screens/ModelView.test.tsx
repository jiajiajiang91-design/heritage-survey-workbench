import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProjectGeometrySpec, geometryGenerationGate } from "@gujian/infrastructure";
import { ModelView, type ModelViewProps } from "./ModelView";
import { componentCandidateFixture } from "../test/component-candidate-fixture";
import { commitGeometryFacts } from "../geometry-fact-service";
import { localActorId, projectCommands, projectRepository } from "../workbench";
import type { Jobs } from "../workbench/useJobs";
import type { EvidencePane } from "../workbench/useEvidencePane";
import { objectSourceModel } from "../object-source-model";
import { IssueQueue } from "./IssueQueue";
import { triggerDownload } from "../workbench/download";
vi.mock("../workbench/download", () => ({ triggerDownload: vi.fn() }));
vi.mock("../GlbViewer", () => ({ GlbViewer: () => <div>测试模型视口</div> }));
afterEach(cleanup);

async function setup() {
  const test = await componentCandidateFixture();
  const head = (await commitGeometryFacts({ head: test.head, values: { components: test.inputs, interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository })).head!;
  const spec = buildProjectGeometrySpec(head, crypto.randomUUID());
  const evidenceId = head.snapshot.evidences[0]!.id;
  const pane: EvidencePane = { activeEvidenceId: evidenceId, setActiveEvidenceId: vi.fn(), activeEvidenceTitle: "内部测试尺寸.txt",
    evidencePreview: { evidenceId, url: "data:image/png;base64,AA==", fileName: "内部关联示意.png", mimeType: "image/png" }, imageSelection: null, setImageSelection: vi.fn(), downloadEvidence: vi.fn() };
  const props: ModelViewProps = { snapshot: head.snapshot, geometrySpec: spec, geometryRevision: null, geometryBlob: null,
    geometryGate: geometryGenerationGate(head), signedOff: false, jobs: { geometryRunning: false, showGeometryTask: false } as Jobs,
    typeLabel: (type) => type, selectedObjectId: spec.objects[0]!.id, onSelectObject: vi.fn(), onEditComponents: vi.fn(), pane,
    onReviewDimension: vi.fn(), onEnterIssues: vi.fn() };
  return { ...test, head, spec, props, pane };
}
describe("模型对象核对入口", () => {
  it("已有模型可以直接下载当前文件，不依赖图纸或归档草案", async () => {
    const test = await setup();
    const blob = new Blob(["internal-model"], { type: "model/gltf-binary" });
    render(<ModelView {...test.props} geometryBlob={blob} />);
    fireEvent.click(screen.getByRole("button", { name: "下载模型 GLB" }));
    expect(triggerDownload).toHaveBeenLastCalledWith(blob, test.head.snapshot.buildings[0]!.name + ".glb");
  });
  it("任务尚未确认时直接进入任务，构件缺项仍进入构件页", async () => {
    const test = await setup(); const task = vi.fn();
    render(<ModelView {...test.props} geometryGate={{ ready: false, missing: ["task.confirmed", "geometry.component.*"] }} onEditTask={task} />);
    fireEvent.click(screen.getByRole("button", { name: "确认制作任务" }));
    expect(task).toHaveBeenCalledOnce();
    expect(test.props.onEditComponents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "填写构件输入" }));
    expect(test.props.onEditComponents).toHaveBeenCalledOnce();
  });
  it("墙体与圆柱联动原件区域，已采用尺寸和相关问题可直接进入核对", async () => {
    const test = await setup();
    function View() {
      const [selected, select] = useState<string | null>(test.spec.objects[0]!.id);
      return <ModelView {...test.props} selectedObjectId={selected} onSelectObject={select} />;
    }
    const view = render(<View />);
    expect(test.pane.setActiveEvidenceId).toHaveBeenCalledWith(test.pane.activeEvidenceId);
    expect(test.pane.setImageSelection).toHaveBeenCalledWith(null);
    expect(view.container.querySelector(".evidence-marquee__rect")).toHaveStyle({ left: "10%", top: "10%", width: "40%", height: "50%" });
    expect(screen.getByText("总宽 · 6000 mm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "核对尺寸：总宽" }));
    expect(test.props.onReviewDimension).toHaveBeenCalledWith({ candidateId: test.candidate.id, rowIndex: 0 });
    fireEvent.click(screen.getByRole("button", { name: "处理相关问题" }));
    expect(test.props.onEnterIssues).toHaveBeenCalledWith(objectSourceModel(test.head.snapshot, test.spec.objects[0]!).issues[0]!.id);
    fireEvent.click(screen.getByRole("button", { name: "选择对象：C-002 · 内部圆柱" }));
    expect(view.container.querySelector(".evidence-marquee__rect")).toHaveStyle({ left: "70%", top: "20%", width: "10%", height: "50%" });
    expect(screen.getByText("当前模型 · 半径")).toBeInTheDocument();
    expect(screen.getByText("200 mm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对尺寸：总宽" })).not.toBeInTheDocument();
  });
  it("候选失效时历史对象仍显示来源问题；异步原图不匹配时不显示区域", async () => {
    const test = await setup(); const snapshot = structuredClone(test.head.snapshot);
    snapshot.candidates.find((row) => row.id === test.recognition.id)!.reviewStatus = "rejected";
    const pane = { ...test.pane, evidencePreview: { ...test.pane.evidencePreview!, evidenceId: crypto.randomUUID() } };
    const view = render(<ModelView {...test.props} snapshot={snapshot} geometryGate={geometryGenerationGate({ ...test.head, snapshot })} pane={pane} />);
    expect(screen.getByRole("status")).toHaveTextContent("驳回");
    expect(screen.getByRole("status")).toHaveTextContent("当前模型保留供查看");
    expect(view.container.querySelector(".evidence-marquee__rect")).not.toBeInTheDocument();
    expect(screen.getByText("请补齐模型制作输入")).toBeInTheDocument();
  });
  it("直接填写的长度修改后对照旧模型，问题队列进入指定来源问题", async () => {
    const test = await setup(); const current = structuredClone(test.inputs[0]!);
    if (current.solid.kind === "box") current.solid.sizeY = "260";
    const head = (await commitGeometryFacts({ head: test.head, values: { components: [current], interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository })).head!;
    const view = render(<ModelView {...test.props} snapshot={head.snapshot} />);
    expect(screen.getByText("已修改制作输入")).toBeInTheDocument();
    expect(screen.getByText("260 mm")).toBeInTheDocument(); expect(screen.getByText("240 mm")).toBeInTheDocument();
    const issue = head.snapshot.issues.find((item) => item.subjectRefs.includes(test.recognition.id))!;
    view.unmount();
    const decide = vi.fn().mockResolvedValue(false);
    render(<IssueQueue snapshot={head.snapshot} openIssues={head.snapshot.issues.filter((item) => item.status === "open")} initialIssueId={issue.id} taskConfirmed evidenceTitle={() => "内部原件"} humanInterventions={null}
      onDecideCandidate={decide} onDecideOption={vi.fn()} onGoToTask={vi.fn()} onGoToEvidence={vi.fn()} />);
    expect(screen.getByRole("button", { name: "接受为已核对候选" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /助手的识别结果还没有确认/ }).filter((button) => button.getAttribute("aria-current") === "true")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "接受为已核对候选" }));
    expect(decide).toHaveBeenCalledWith(issue.id, test.recognition.id, "accepted", "");
  });
});
