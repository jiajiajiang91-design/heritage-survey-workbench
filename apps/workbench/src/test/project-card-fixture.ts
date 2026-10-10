import type { ProjectCard } from "../workbench";

export function projectCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    projectId: "task-1", name: "测绘项目", buildingName: "山门", status: "active",
    updatedAt: "2026-09-30T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", signedAt: null,
    taskName: "首层平面制作", scaleLabel: "1:100", locationText: null,
    evidenceCount: 1, photoCount: 0, drawingCount: 1, factCount: 0, objectCount: 0,
    artifactCount: 0, pendingCount: 0, checkedArtifactCount: 0, demoLimitationZh: null, coverUrl: null,
    ...overrides,
  };
}
