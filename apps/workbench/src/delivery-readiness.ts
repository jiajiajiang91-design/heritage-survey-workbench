import type { ProjectHead } from "@gujian/application";
import type { ArtifactRecord } from "@gujian/domain";

type Task = ProjectHead["snapshot"]["taskDefinitions"][number];

export function isModelOnlyTask(task: Task | null): boolean {
  const targets = task?.productionSetup?.targets;
  return targets?.length === 1 && targets[0] === "model";
}

export function checkedArtifactsMeetTask(task: Task | null, artifacts: readonly Pick<ArtifactRecord, "kind">[]): boolean {
  if (!task?.confirmedAt) return false;
  const kinds = new Set(artifacts.map((item) => item.kind));
  return isModelOnlyTask(task) ? kinds.has("ifc") && kinds.has("glb") : kinds.has("dxf") && kinds.has("pdf");
}
