import type { ProjectHead, ProjectCommandService } from "@gujian/application";
import { FactEnvelopeSchema, type ProductionSetup } from "@gujian/domain";
import type { IndexedDbProjectRepository } from "@gujian/infrastructure";
import { z } from "zod";
import { evidenceReadability } from "./evidence-readability";

export const COVERAGE_LABELS = { plan: "平面范围", scale: "尺度依据", height: "高度依据", elevation: "指定立面", section: "指定剖面" } as const;
export const COVERAGE_HINTS = { plan: "页码、范围和方向", scale: "页码、尺寸或比例标注及单位", height: "页码和高度标注", elevation: "页码、立面方向及尺度依据", section: "页码、剖切位置及高度、厚度依据" } as const;
export const CoverageEntrySchema = z.object({ purpose: z.enum(["plan", "scale", "height", "elevation", "section"]), sourceLocation: z.string().trim().min(1, "请填写来源位置。").max(500) }).strict();
const CoverageSchema = z.object({ kind: z.literal("materialCoverage"), buildingId: z.string().uuid(), entries: z.array(CoverageEntrySchema).max(5) }).strict()
  .refine((value) => new Set(value.entries.map((entry) => entry.purpose)).size === value.entries.length, "同类内容只能登记一次。");
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;
type Snapshot = ProjectHead["snapshot"];
export function coverageBuilding(snapshot: Snapshot) {
  const setup = snapshot.taskDefinitions.find((task) => task.confirmedAt)?.productionSetup;
  return setup ? snapshot.buildings.find((building) => building.id === setup.buildingId && building.projectId === snapshot.project.id)
    : snapshot.buildings.find((building) => building.projectId === snapshot.project.id);
}
export function coverageRequirements(targets: ProductionSetup["targets"]): CoverageEntry["purpose"][] {
  if (!targets.length) return [];
  return ["plan", "scale", ...(targets.includes("model") ? ["height"] : []), ...(targets.includes("elevation") ? ["elevation"] : []), ...(targets.includes("section") ? ["section"] : [])] as CoverageEntry["purpose"][];
}
export function coverageEntries(snapshot: Snapshot, evidenceId: string): CoverageEntry[] {
  const building = coverageBuilding(snapshot);
  if (!building || !snapshot.evidences.some((item) => item.id === evidenceId && item.projectId === snapshot.project.id) || evidenceReadability(snapshot, evidenceId).state !== "readable") return [];
  const fact = snapshot.facts.filter((item) => item.subjectRef === evidenceId && item.field === "evidence.coverage." + building.id).at(-1);
  if (!fact || fact.producer.producerType !== "human" || fact.reviewStatus !== "confirmed" || fact.dataStatus !== "available" || !fact.evidenceRefs.includes(evidenceId)) return [];
  const value = CoverageSchema.safeParse(fact.value);
  return value.success && value.data.buildingId === building.id ? value.data.entries : [];
}
export function materialCoverage(snapshot: Snapshot) {
  const targets = snapshot.taskDefinitions.find((task) => task.confirmedAt)?.productionSetup?.targets ?? [];
  return coverageRequirements(targets).map((purpose) => ({ purpose, label: COVERAGE_LABELS[purpose], sources: snapshot.evidences.flatMap((evidence) =>
    coverageEntries(snapshot, evidence.id).filter((entry) => entry.purpose === purpose).map((entry) => ({ evidenceId: evidence.id, title: evidence.title, location: entry.sourceLocation }))) }));
}
export async function commitMaterialCoverage(input: { head: ProjectHead; evidenceId: string; entries: CoverageEntry[]; actorId: string; commands: ProjectCommandService; repository: IndexedDbProjectRepository }) {
  const building = coverageBuilding(input.head.snapshot);
  const evidence = input.head.snapshot.evidences.find((item) => item.id === input.evidenceId && item.projectId === input.head.projectId);
  if (!building || !evidence || evidenceReadability(input.head.snapshot, evidence.id).state !== "readable") throw new Error("请先选择本任务的可读原件。");
  const value = CoverageSchema.parse({ kind: "materialCoverage", buildingId: building.id, entries: input.entries });
  const commandId = crypto.randomUUID();
  const fact = FactEnvelopeSchema.parse({ id: crypto.randomUUID(), subjectRef: evidence.id, field: "evidence.coverage." + building.id, value,
    producer: { producerType: "human", actorId: input.actorId, actionRef: { commandId } }, evidenceRefs: [evidence.id], reviewStatus: "confirmed", acceptanceRef: { type: "command", id: commandId }, dataStatus: "available" });
  await input.commands.execute({ commandType: "CommitFacts", commandId, projectId: input.head.projectId, actorId: input.actorId, expectedRevisionId: input.head.revisionId, issuedAt: new Date().toISOString(), payload: { facts: [fact] } });
  const head = await input.repository.getProjectHead(input.head.projectId);
  if (!head) throw new Error("已保存覆盖记录，请重新打开任务。");
  return head;
}
