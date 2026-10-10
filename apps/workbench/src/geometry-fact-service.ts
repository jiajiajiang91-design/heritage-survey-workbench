import { ProjectCommandService, type ProjectHead } from "@gujian/application";
import { type FactEnvelope, FactEnvelopeSchema } from "@gujian/domain";
import { IndexedDbProjectRepository } from "@gujian/infrastructure";
import { z } from "zod";
import { buildComponentInput, componentDraft } from "./component-input";

import {
  EvidenceGeometryComponentValueSchema,
  EvidenceGeometryInterfaceValueSchema,
} from "@gujian/infrastructure";

export interface GeometryFactInput {
  components: z.infer<typeof EvidenceGeometryComponentValueSchema>[];
  interfaces: z.infer<typeof EvidenceGeometryInterfaceValueSchema>[];
}

export function buildGeometryFacts(input: {
  head: ProjectHead;
  actorId: string;
  values: GeometryFactInput;
  commandId: string;
}): FactEnvelope[] {
  const components = z.array(EvidenceGeometryComponentValueSchema).min(1).max(1_000).parse(input.values.components);
  const interfaces = z.array(EvidenceGeometryInterfaceValueSchema).max(1_000).parse(input.values.interfaces);
  if (components.length + interfaces.length > 1_000) throw new Error("单次保存最多 1000 条构件及连接记录。");
  for (const component of components) {
    const result = buildComponentInput(input.head.snapshot, componentDraft(component), component);
    if (!result.value) throw new Error(Object.values(result.errors).join("；"));
  }
  const projectEvidence = new Set(input.head.snapshot.evidences.filter((item) => item.dataStatus === "available").map((item) => item.id));
  const rows = [
    ...components.map((value) => ({ field: `geometry.component.${value.stableKey}`, value, evidenceRefs: value.evidenceRefs })),
    ...interfaces.map((value, index) => ({ field: `geometry.interface.${value.fromStableKey}.${value.toStableKey}.${index}`, value, evidenceRefs: value.evidenceRefs })),
  ];
  if (new Set(rows.map((row) => row.field)).size !== rows.length) throw new Error("GEOMETRY_FACT_FIELDS_NOT_UNIQUE");
  const missingEvidence = [...new Set(rows.flatMap((row) => row.evidenceRefs).filter((id) => !projectEvidence.has(id)))];
  if (missingEvidence.length) throw new Error(`GEOMETRY_FACT_EVIDENCE_NOT_IN_PROJECT:${missingEvidence.join(",")}`);

  const commandId = input.commandId;
  const facts: FactEnvelope[] = rows.map(({ field, value, evidenceRefs }) => FactEnvelopeSchema.parse({
    id: crypto.randomUUID(),
    subjectRef: input.head.snapshot.buildings[0]!.id,
    field,
    value,
    producer: { producerType: "human", actorId: input.actorId, actionRef: { commandId } },
    evidenceRefs,
    reviewStatus: "confirmed",
    acceptanceRef: { type: "command", id: commandId },
    dataStatus: "available",
  }));
  return facts;
}

export async function commitGeometryFacts(input: {
  head: ProjectHead; actorId: string; values: GeometryFactInput;
  repository: IndexedDbProjectRepository; commands: ProjectCommandService;
}): Promise<{ head: ProjectHead | null }> {
  const commandId = crypto.randomUUID();
  const facts = buildGeometryFacts({ ...input, commandId });
  await input.commands.execute({
    commandType: "CommitFacts",
    commandId,
    projectId: input.head.projectId,
    actorId: input.actorId,
    expectedRevisionId: input.head.revisionId,
    issuedAt: new Date().toISOString(),
    payload: { facts },
  });
  const head = await input.repository.getProjectHead(input.head.projectId).catch(() => null);
  return { head };
}
