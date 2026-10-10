import type { ProjectSnapshot } from "@gujian/domain";

export const sampleTask: ProjectSnapshot["taskDefinitions"][number] = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "测试建筑制作", scope: ["首层模型与图纸"], regulationRefs: ["按原图明确尺寸"], deliverables: ["平面 DXF", "平面 PDF"],
  responsibilities: [{ role: "projectLead", actorId: "22222222-2222-4222-8222-222222222222" }],
  automationPolicyRef: null, confirmedAt: "2026-09-05T10:00:00.000Z",
  artifactRequirements: {
    titleZh: "测试建筑", revisionLabel: "P1", geometryTargetRoles: ["wall"],
    sheets: [{ key: "sheet-main", drawingNumber: "P-01", displayLabelZh: "首层图纸", pageMm: [420, 297] }],
    views: [{
      key: "view-plan", displayLabelZh: "首层平面", drawingRef: "平-01", kind: "floorPlan", scaleDenominator: 100,
      sheetKey: "sheet-main", viewportRectMm: [20, 40, 380, 217],
      direction: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0],
      sectionPlane: { normal: [0, 0, 1], offsetMm: 1200.25 }, cropBoundsMm: [-20.5, -30.25, 15000, 20000],
      targetStableKeys: ["wall-1"], sourceEvidenceRefs: ["evidence-1"],
    }],
  },
};
export const sampleReferences = {
  components: [{ value: "wall-1", label: "东墙" }],
  evidences: [{ value: "evidence-1", label: "原始平面图" }],
};

