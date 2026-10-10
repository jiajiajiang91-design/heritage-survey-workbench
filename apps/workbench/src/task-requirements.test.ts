// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@gujian/domain";
import { requirementsDraft, readRequirementsDraft, validateRequirements, describeRequirementChanges, newView, newSheet } from "./task-requirements";
import { sampleTask, sampleReferences } from "./test/task-fixture";

const fixture = () => requirementsDraft(sampleTask.artifactRequirements);
const unzip = createRequire(resolve(import.meta.dirname, "../../../packages/infrastructure/package.json"))("fflate").unzipSync as (
  data: Uint8Array, options: { filter: (entry: { name: string }) => boolean },
) => Record<string, Uint8Array>;

describe("成果要求表单数据", () => {
  it("默认视口避开右下图签，旧版面重叠在保存前明确报出", () => {
    const view = newView(newSheet());
    expect(Number(view.viewportRectMm[1])).toBeGreaterThanOrEqual(38);
    const draft = fixture();
    draft.views[0]!.viewportRectMm = ["20", "20", "380", "237"];
    expect(validateRequirements(draft).errors["views.0.viewportRectMm"]).toContain("图签");
    draft.views[0]!.viewportRectMm = ["20", "40", "380", "237"];
    expect(validateRequirements(draft).errors["views.0.viewportRectMm"]).toContain("可打印区域");
    draft.views[0]!.viewportRectMm = view.viewportRectMm;
    expect(validateRequirements(draft).value).not.toBeNull();
  });
  it.each(["gaodu-yuhuang-temple-main-hall", "t0b-construction-sample"])("真实演示包 %s 无修改往返不丢失任何字段", (name) => {
    const entries = unzip(readFileSync(resolve(import.meta.dirname, "../public/demo/" + name + ".gujian.zip")), { filter: (entry) => entry.name === "project.json" });
    const { snapshot } = JSON.parse(new TextDecoder().decode(entries["project.json"])) as { snapshot: ProjectSnapshot };
    const tasks = snapshot.taskDefinitions.filter((task) => task.artifactRequirements);
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(readRequirementsDraft(requirementsDraft(task.artifactRequirements))).toEqual(task.artifactRequirements);
      expect(validateRequirements(requirementsDraft(task.artifactRequirements)).errors).toEqual({});
    }
  });
  it("自定义方向、小数剖切与裁切、引用和稳定键完整保留", () => {
    const task = structuredClone(sampleTask.artifactRequirements!);
    task.views[0]!.direction = [0, 1, 0];
    task.views[0]!.right = [Math.SQRT1_2, 0, Math.SQRT1_2];
    task.views[0]!.up = [-Math.SQRT1_2, 0, Math.SQRT1_2];
    expect(validateRequirements(requirementsDraft(task), sampleReferences).value).toEqual(task);
  });
  it.each(["", "0", "-1", "1.5", "Infinity", "不是数字"])("拒绝非法比例 %s", (scale) => {
    const draft = fixture(); draft.views[0]!.scaleDenominator = scale;
    const result = validateRequirements(draft);
    expect(result.value).toBeNull();
    expect(result.errors["views.0.scaleDenominator"]).toContain("正整数");
  });
  it("空数值不会转换成零，越出图幅必须修正", () => {
    const draft = fixture(); draft.views[0]!.viewportRectMm[0] = "";
    expect(validateRequirements(draft).errors["views.0.viewportRectMm"]).toContain("位于");
    draft.views[0]!.viewportRectMm = ["31", "40", "380", "217"];
    expect(validateRequirements(draft).value).toBeNull();
    draft.views[0]!.viewportRectMm[0] = "30";
    expect(validateRequirements(draft).value).not.toBeNull();
  });
  it("未知图幅、非单位方向与不垂直方向均拒绝", () => {
    const draft = fixture(); draft.views[0]!.sheetKey = "missing";
    expect(validateRequirements(draft).errors["views.0.sheetKey"]).toContain("现有");
    draft.views[0]!.direction = ["0", "0", "2"];
    expect(validateRequirements(draft).errors["views.0.orientation"]).toContain("长度为 1");
    draft.views[0]!.direction = ["1", "0", "0"];
    expect(validateRequirements(draft).errors["views.0.orientation"]).toContain("垂直");
  });
  it("详图缺少剖切、构件、资料或裁切范围不能提交", () => {
    const draft = fixture(); const view = draft.views[0]!;
    view.kind = "detail"; delete view.sectionPlane; delete view.cropBoundsMm;
    view.targetStableKeys = []; view.sourceEvidenceRefs = [];
    const result = validateRequirements(draft, sampleReferences);
    for (const key of ["sectionPlane", "cropBoundsMm", "targetStableKeys", "sourceEvidenceRefs"]) expect(result.errors["views.0." + key]).toBeTruthy();
    expect(result.value).toBeNull();
  });
  it("旧引用缺失时不静默移除", () => {
    const draft = fixture();
    expect(validateRequirements(draft, { components: [], evidences: [] }).value).toBeNull();
    expect(readRequirementsDraft(draft).views[0]!.sourceEvidenceRefs).toEqual(["evidence-1"]);
  });
  it("变化摘要区分新增、修改和移除", () => {
    const before = fixture(); const after = fixture();
    after.views[0]!.scaleDenominator = "50";
    after.sheets[0]!.key = "new-sheet";
    expect(describeRequirementChanges(before, after)).toEqual(["新增图幅：首层图纸", "移除图幅：首层图纸", "修改视图：首层平面"]);
  });
});
