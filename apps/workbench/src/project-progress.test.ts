import { describe, expect, it, vi } from "vitest";
import { productionSummary, visibleTaskCards } from "./project-progress";
import { projectCard } from "./test/project-card-fixture";
import { dimensionFixture } from "./test/dimension-fixture";
import { listProjectCards, projectRepository } from "./workbench";

describe("首页制作任务摘要", () => {
  it("单位待更新优先显示，只有历史文件时不进入已有成果筛选", () => {
    const card = projectCard({ outputUnitPending: true, artifactCount: 0, pendingCount: 1, signedAt: "2026-09-01T00:00:00Z" });
    expect(productionSummary(card)).toEqual({ label: "输出单位待更新", next: "按当前单位重新生成并检查成果" });
    expect(visibleTaskCards([card], "", "results")).toEqual([]);
    expect(visibleTaskCards([card], "", "pending")).toEqual([card]);
  });
  it("签发或已有旧文件不代表本次任务完成", () => {
    const card = projectCard({ signedAt: "2026-09-01T10:00:00Z", artifactCount: 20, pendingCount: 3 });
    expect(productionSummary(card)).toEqual({ label: "待核对", next: "处理 3 项候选或问题" });
    expect(productionSummary({ ...card, pendingCount: 0 }).label).toBe("已有成果，待复查");
  });

  it("明确显示缺任务与缺资料", () => {
    expect(productionSummary(projectCard({ taskName: null })).label).toBe("待定义任务");
    expect(productionSummary(projectCard({ evidenceCount: 0 })).label).toBe("待添加资料");
  });

  it("待处理优先，其余按最近修改，检索不修改原数组", () => {
    const oldPending = projectCard({ projectId: "old-pending", pendingCount: 2, updatedAt: "2026-09-01" });
    const recent = projectCard({ projectId: "recent", updatedAt: "2026-09-30" });
    const older = projectCard({ projectId: "older", updatedAt: "2026-09-20" });
    const cards = [older, recent, oldPending];
    expect(visibleTaskCards(cards, " 山门 ", "all").map((item) => item.projectId)).toEqual(["old-pending", "recent", "older"]);
    expect(cards.map((item) => item.projectId)).toEqual(["older", "recent", "old-pending"]);
  });

  it("100 条摘要按任务与项目检索，状态条件可以组合", () => {
    const cards = Array.from({ length: 100 }, (_, i) => projectCard({ projectId: "task-" + i, buildingName: "建筑" + i,
      taskName: "成果" + i, name: i < 50 ? "区域甲" : "区域乙", pendingCount: i % 2, artifactCount: i >= 50 ? 1 : 0 }));
    expect(visibleTaskCards(cards, "成果99", "pending").map((item) => item.buildingName)).toEqual(["建筑99"]);
    expect(visibleTaskCards(cards, "区域乙", "results")).toHaveLength(50);
    expect(visibleTaskCards(cards, "成果98", "pending")).toHaveLength(0);
  });

  it("首页读取摘要时不请求照片或模型 Blob", async () => {
    const source = await dimensionFixture();
    const head = { ...source.head, snapshot: { ...source.head.snapshot,
      evidences: source.head.snapshot.evidences.map((item) => ({ ...item, evidenceType: "photo" as const })) } };
    const headSpy = vi.spyOn(projectRepository, "getProjectHead").mockResolvedValue(head);
    const assetSpy = vi.spyOn(projectRepository, "getAsset");
    try {
      const cards = await listProjectCards();
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]?.photoCount).toBeGreaterThan(0);
      expect(assetSpy).not.toHaveBeenCalled();
    } finally { headSpy.mockRestore(); assetSpy.mockRestore(); }
  });
});
