import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckRunSchema } from "@gujian/domain";
import { ChecksAndQualification, type ChecksAndQualificationProps } from "./ChecksAndQualification";
import { triggerDownload } from "../workbench/download";
vi.mock("../GlbViewer", () => ({ GlbViewer: () => <div>内部模型视口</div> }));
vi.mock("../workbench/download", () => ({ triggerDownload: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function props(): ChecksAndQualificationProps {
  return { modelOnly: true, hasModel: true, modelBlob: new Blob(["internal-model"]), modelFileName: "内部墙体.glb",
    previews: [], drawingArtifacts: [], latestCheckRun: null, unknownCount: 1, currentArtifactCount: 0,
    crossRevisionArtifactCount: 0, qualificationLabel: "待签发成果", signoff: null, demoLimitationZh: null,
    blockerReasons: [], blockerCodes: ["PROFESSIONAL_REVIEW_REQUIRED"], generating: false, canRegenerate: true,
    onRegenerate: vi.fn(), onDownload: vi.fn(), requirements: null, onCheckModel: vi.fn(), onOpenModel: vi.fn() };
}
function checkRun(code: string) {
  return CheckRunSchema.parse({ id: crypto.randomUUID(), projectId: crypto.randomUUID(), projectRevisionId: crypto.randomUUID(),
    geometryRevisionId: crypto.randomUUID(), artifactRefs: [crypto.randomUUID()], status: "completed",
    results: [{ code, outcome: "passed", message: "内部文件检查", sourceRefs: [] },
      { code: "PROFESSIONAL_REVIEW_REQUIRED", outcome: "blocked", message: "尚待专业复核", sourceRefs: [] }],
    reportAssetId: crypto.randomUUID(), reportHash: "0".repeat(64), qualification: "generated-not-qualified",
    l1Eligible: false, formalEligibility: false, completedAt: new Date().toISOString() });
}

describe("仅模型检查页面", () => {
  it("已有模型直接显示且检查与返回不要求出图，下载当前Blob", () => {
    const p = props(); render(<ChecksAndQualification {...p} />);
    expect(screen.getByText("内部模型视口")).toBeInTheDocument();
    expect(screen.getByText("模型已生成，待检查")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新出图并检查" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出 DXF 与 PDF" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查模型文件" })); expect(p.onCheckModel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "返回三维模型" })); expect(p.onOpenModel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "下载 GLB 模型" }));
    expect(triggerDownload).toHaveBeenLastCalledWith(p.modelBlob, "内部墙体.glb"); expect(p.onRegenerate).not.toHaveBeenCalled();
  });
  it("旧图纸检查不冒充模型检查，已检查模型的输入变化后提示更新", () => {
    const p = props(); const view = render(<ChecksAndQualification {...p} latestCheckRun={checkRun("DRAWING_OUTPUT_HASH_CLOSURE")} />);
    expect(screen.queryByText("文件检查通过")).not.toBeInTheDocument();
    expect(screen.getByText("模型已生成，待检查")).toBeInTheDocument();
    view.rerender(<ChecksAndQualification {...p} latestCheckRun={checkRun("MODEL_OUTPUT_HASH_CLOSURE")} />);
    expect(screen.getByText("文件检查通过")).toBeInTheDocument();
    expect(screen.getByText("模型已检查，待专业复核")).toBeInTheDocument();
    expect(screen.getByText("还不能")).toBeInTheDocument();
    view.rerender(<ChecksAndQualification {...p} latestCheckRun={checkRun("MODEL_OUTPUT_HASH_CLOSURE")} modelNeedsUpdate />);
    expect(screen.getByText("模型待更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查模型文件" })).toBeDisabled();
    expect(screen.queryByText("文件检查通过")).not.toBeInTheDocument();
    view.rerender(<ChecksAndQualification {...p} hasModel={false} modelBlob={null} />);
    expect(screen.getByText("未生成模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查模型文件" })).toBeDisabled();
  });
});
