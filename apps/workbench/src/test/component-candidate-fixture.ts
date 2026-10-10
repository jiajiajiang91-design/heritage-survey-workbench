import { ModelCandidateSchema } from "@gujian/domain";
import type { ProjectHead } from "@gujian/application";
import { candidateComponentKey } from "@gujian/infrastructure";
import { componentFixture } from "./component-fixture";
import { localActorId, projectCommands, projectRepository, workflow } from "../workbench";
import type { ComponentInput } from "../component-input";
import { readRequirementsDraft, requirementsDraft } from "../task-requirements";

export async function addComponentCandidate(head: ProjectHead) {
  const at = new Date().toISOString();
  const runId = crypto.randomUUID();
  const evidenceRef = head.snapshot.evidences[0]!.id;
  const candidate = ModelCandidateSchema.parse({ id: crypto.randomUUID(), projectId: head.projectId, runId,
    inputRevisionId: head.revisionId, taskType: "component-recognition", contentText: "内部构件关联测试，不是真实识别",
    structured: { kind: "componentRecognition", summary: "内部墙体与圆柱", components: [
      { nameZh: "内部墙体", categoryZh: "墙体", evidenceRef, region: { x: .1, y: .1, width: .4, height: .5 }, certainty: "certain", noteZh: "内部关联数据" },
      { nameZh: "内部圆柱", categoryZh: "柱", evidenceRef, region: { x: .7, y: .2, width: .1, height: .5 }, certainty: "uncertain", noteZh: "仍需人工核对类型和参数" },
    ], missingInformation: ["仅验证对象关联，未执行真实模型"] },
    producer: { producerType: "model", runId }, evidenceRefs: [evidenceRef], reviewStatus: "unreviewed", createdAt: at });
  await projectCommands.execute({ commandType: "CommitModelRunResult", commandId: crypto.randomUUID(), projectId: head.projectId,
    actorId: localActorId(), expectedRevisionId: head.revisionId, issuedAt: at, payload: { candidate,
      run: { id: runId, projectId: head.projectId, inputRevisionId: head.revisionId, inputHash: "c".repeat(64), provider: "internal-test", model: "fixture-not-real-model", taskType: "component-recognition", status: "succeeded",
        evidenceRefs: [evidenceRef], usage: null, outputHash: "d".repeat(64), startedAt: at, completedAt: at,
        events: (["queued", "succeeded"] as const).map((eventType, sequence) => ({ id: crypto.randomUUID(), runId, sequence, eventType, attempt: 1, detail: "内部测试，未联网", occurredAt: at })) } } });
  return { head: (await projectRepository.getProjectHead(head.projectId))!, candidate };
}
export async function componentCandidateFixture() {
  const test = await componentFixture();
  const { candidate, head: recognized } = await addComponentCandidate(test.head);
  const evidenceRef = test.component.evidenceRefs[0]!;
  const draft = requirementsDraft(); draft.titleZh = "内部局部构件核对"; draft.geometryTargetRoles = ["wall", "column"];
  draft.sheets[0]!.drawingNumber = "内部-01"; draft.sheets[0]!.displayLabelZh = "内部平面";
  draft.views[0]!.displayLabelZh = "内部平面"; draft.views[0]!.drawingRef = "内部-01"; draft.views[0]!.sourceEvidenceRefs = [evidenceRef];
  const head = await workflow.confirmTaskSetup(recognized, localActorId(),
    { taskName: "内部对象关联测试", scope: ["两种内部构件"], regulationRefs: [], deliverables: ["内部模型"], artifactRequirements: readRequirementsDraft(draft) });
  const linked = (rowIndex: number): ComponentInput => ({ ...test.component, stableKey: candidateComponentKey(candidate.id, rowIndex),
    candidateSource: { candidateId: candidate.id, rowIndex }, displayNameZh: rowIndex ? "内部圆柱" : "内部墙体",
    componentType: rowIndex ? "column" : "wall", conceptRef: rowIndex ? "column-test" : "wall-test",
    solid: rowIndex ? { kind: "cylinder", radius: "200", height: "3000", axis: "z", centerMm: [6800, 200, 1500] } : test.component.solid,
    ...(rowIndex ? {} : { dimensionBindings: [{ field: "sizeX", sourceFactRef: test.dimension.id }] }) });
  return { ...test, head, recognition: candidate, inputs: [linked(0), linked(1)] };
}
