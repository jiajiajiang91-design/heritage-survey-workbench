import { File as NodeFile } from "node:buffer";
import type { ModelCandidate, TranscribedDimension } from "@gujian/domain";
import type { ProjectHead } from "@gujian/application";
import { createLocalProject, evidenceIngestion, localActorId, projectCommands, projectRepository } from "../workbench";

export async function addDimensionCandidate(head: ProjectHead, dimensions?: TranscribedDimension[]) {
  const runId = crypto.randomUUID();
  const at = new Date().toISOString();
  const evidenceRef = head.snapshot.evidences[0]!.id;
  const candidate: ModelCandidate = {
    id: crypto.randomUUID(), projectId: head.projectId, runId, inputRevisionId: head.revisionId,
    taskType: "measurement-transcription", contentText: "内部交互测试候选，非真实模型运行",
    structured: { kind: "measurementTranscription", summary: "内部测试：总宽、总深及不确定高度", dimensions: dimensions ?? [
      { partZh: "总宽", valueText: "6000", valueMm: "6000", evidenceRef, locationZh: "测试记录第 1 行", certainty: "certain", noteZh: "内部测试数值" },
      { partZh: "总深", valueText: "4200", valueMm: "4200", evidenceRef, locationZh: "测试记录第 2 行", certainty: "certain", noteZh: null },
      { partZh: "层高", valueText: "3?00", valueMm: null, evidenceRef, locationZh: "测试记录第 3 行", certainty: "uncertain", noteZh: "原资料须补充，不能按猜测采用" },
    ], missingInformation: ["本文件仅用于交互测试，不用于建筑制作"] },
    producer: { producerType: "model", runId }, evidenceRefs: [evidenceRef], reviewStatus: "unreviewed", createdAt: at,
  };
  await projectCommands.execute({
    commandType: "CommitModelRunResult", commandId: crypto.randomUUID(), projectId: head.projectId,
    actorId: localActorId(), expectedRevisionId: head.revisionId, issuedAt: at,
    payload: {
      run: { id: runId, projectId: head.projectId, inputRevisionId: head.revisionId, inputHash: "a".repeat(64),
        provider: "internal-test", model: "test-fixture-not-a-real-run", taskType: "measurement-transcription",
        status: "succeeded", evidenceRefs: [evidenceRef], usage: null, outputHash: "b".repeat(64), startedAt: at, completedAt: at,
        events: (["queued", "succeeded"] as const).map((eventType, sequence) => ({ id: crypto.randomUUID(), runId, sequence, eventType, attempt: 1, detail: "内部测试记录，未调用模型", occurredAt: at })),
      }, candidate,
    },
  });
  return { head: (await projectRepository.getProjectHead(head.projectId))!, candidate };
}
export async function dimensionFixture() {
  const created = await createLocalProject({ name: "单元13尺寸核对内部测试", buildingName: "内部测试建筑", locationText: "" });
  const source = new NodeFile(["内部测试资料，不是实测记录。\n总宽 6000 mm\n总深 4200 mm\n层高 3?00 mm\n"], "内部测试尺寸.txt", { type: "text/plain" });
  const head = await evidenceIngestion.ingest(created, localActorId(), source as unknown as File);
  return addDimensionCandidate(head);
}

