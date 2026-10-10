import type { ProjectCard } from "./workbench";

export type TaskFilter = "all" | "active" | "pending" | "results";

export function productionSummary(card: ProjectCard): { label: string; next: string } {
  if (!card.taskName) return { label: "待定义任务", next: "填写本次成果要求" };
  if (!card.evidenceCount) return { label: "待添加资料", next: "添加建筑图纸、照片或尺寸记录" };
  if (card.outputUnitPending) return { label: "输出单位待更新", next: "按当前单位重新生成并检查成果" };
  if (card.pendingCount) return { label: "待核对", next: `处理 ${card.pendingCount} 项候选或问题` };
  if (card.artifactCount) return { label: "已有成果，待复查", next: "查看本次成果并核对任务要求" };
  if (card.objectCount) return { label: "已有构件", next: "查看模型并核对所选成果" };
  return { label: "资料已准备", next: "提取并核对尺寸与构件" };
}

export function visibleTaskCards(cards: readonly ProjectCard[], search: string, filter: TaskFilter): ProjectCard[] {
  const query = search.trim().toLocaleLowerCase();
  return cards.filter((card) => {
    const matches = [card.buildingName, card.taskName, card.name].some((value) => value?.toLocaleLowerCase().includes(query));
    const selected = filter === "all" || (filter === "active" && card.status === "active")
      || (filter === "pending" && card.pendingCount > 0) || (filter === "results" && card.artifactCount > 0);
    return matches && selected;
  }).sort((left, right) => Number(right.pendingCount > 0) - Number(left.pendingCount > 0)
    || right.updatedAt.localeCompare(left.updatedAt) || left.projectId.localeCompare(right.projectId));
}
