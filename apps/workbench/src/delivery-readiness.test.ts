import { describe, expect, it } from "vitest";
import { checkedArtifactsMeetTask } from "./delivery-readiness";
import { emptyProductionTask, taskFromProduction } from "./production-task";

describe("当前目标的草案条件", () => {
  it("新增图纸目标不复用模型检查，改成仅模型也不借图纸检查放行", () => {
    const task = taskFromProduction({ ...emptyProductionTask(), taskName: "内部任务", buildingName: "内部建筑", targets: ["model"] }, crypto.randomUUID(), crypto.randomUUID());
    const models = [{ kind: "ifc" as const }, { kind: "glb" as const }];
    const drawings = [{ kind: "dxf" as const }, { kind: "pdf" as const }];
    expect(checkedArtifactsMeetTask(task, models)).toBe(true);
    const mixed = taskFromProduction({ ...emptyProductionTask(), taskName: "内部任务", buildingName: "内部建筑", targets: ["model", "floorPlan"] }, task.productionSetup!.buildingId, crypto.randomUUID(), task);
    expect(checkedArtifactsMeetTask(mixed, models)).toBe(false);
    expect(checkedArtifactsMeetTask(mixed, drawings)).toBe(true);
    expect(checkedArtifactsMeetTask(task, drawings)).toBe(false);
    expect(checkedArtifactsMeetTask({ ...task, confirmedAt: null }, models)).toBe(false);
  });
});
