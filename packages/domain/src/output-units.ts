import { z } from "zod";
import type { ProjectSnapshot } from "./project.js";
import type { ArtifactRecord } from "./delivery.js";
import type { ArtifactRequirementMatrix } from "./drawings.js";

export const OutputUnitSchema = z.enum(["mm", "cm", "m"]);
export type OutputUnit = z.infer<typeof OutputUnitSchema>;
export function taskOutputUnit(snapshot: Pick<ProjectSnapshot, "taskDefinitions">): OutputUnit {
  return snapshot.taskDefinitions.find((task) => task.confirmedAt !== null)?.productionSetup?.outputUnit ?? "mm";
}
export function geometryOutputUnitMatches(snapshot: Pick<ProjectSnapshot, "taskDefinitions" | "geometryRevisions" | "geometrySpecs">, geometryRevisionId = snapshot.geometryRevisions.at(-1)?.id): boolean {
  const revision = snapshot.geometryRevisions.find((item) => item.id === geometryRevisionId);
  const spec = snapshot.geometrySpecs.find((item) => item.id === revision?.geometrySpecId);
  return (spec?.outputUnit ?? "mm") === taskOutputUnit(snapshot);
}
export function artifactOutputUnitMatches(snapshot: Pick<ProjectSnapshot, "taskDefinitions" | "geometryRevisions" | "geometrySpecs">, artifact: Pick<ArtifactRecord, "requirementMatrixId" | "geometryRevisionId" | "kind">, matrices: readonly ArtifactRequirementMatrix[]): boolean {
  const model = ["ifc", "glb", "brepBundle", "geometryManifest", "geometrySourceMap", "geometryReport", "geometryPreview"].includes(artifact.kind);
  return model || artifact.requirementMatrixId === null ? geometryOutputUnitMatches(snapshot, artifact.geometryRevisionId)
    : (matrices.find((matrix) => matrix.id === artifact.requirementMatrixId)?.outputUnit ?? "mm") === taskOutputUnit(snapshot);
}
export function outputUnitUpdateState(snapshot: Pick<ProjectSnapshot, "taskDefinitions" | "geometryRevisions" | "geometrySpecs">, artifacts: readonly ArtifactRecord[], matrices: readonly ArtifactRequirementMatrix[]) {
  const geometry = snapshot.geometryRevisions.at(-1);
  const drawings = artifacts.filter((item) => item.geometryRevisionId === geometry?.id && item.requirementMatrixId !== null);
  return { model: Boolean(geometry && !geometryOutputUnitMatches(snapshot)),
    drawings: drawings.length > 0 && !drawings.some((item) => artifactOutputUnitMatches(snapshot, item, matrices)) };
}
