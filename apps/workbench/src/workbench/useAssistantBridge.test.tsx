import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useAssistantBridge } from "./useAssistantBridge";
import { componentFixture } from "../test/component-fixture";
import { commitMaterialCoverage } from "../material-coverage";
import { localActorId, projectCommands, projectRepository } from "../workbench";
afterEach(cleanup);
it("助手实际快照只将尺寸记录写入尺寸上下文", async () => {
  const test = await componentFixture(); const evidenceId = test.head.snapshot.evidences[0]!.id;
  const head = await commitMaterialCoverage({ head: test.head, evidenceId, entries: [], actorId: localActorId(), commands: projectCommands, repository: projectRepository });
  const deps = { session: { selected: head, openIssues: [], geometrySpec: null, projectCards: [], projectArtifacts: [], projectDeliveries: [], projectModelRuns: [], projectRuleRuns: [], projectDecisions: [], projectCheckRuns: [], projectDeliveryEvaluations: [], parsedEvidenceCount: 1 },
    nav: { activeStage: "measurement-baseline", selectedGeometryEntity: null }, jobs: {}, evidence: { imageSelection: null }, writes: { assistantExecutors: {} }, notices: {} } as unknown as Parameters<typeof useAssistantBridge>[0];
  const { result } = renderHook(() => useAssistantBridge(deps));
  const context = result.current.buildAssistantSnapshot().contextZh;
  expect(context).toContain("尺寸记录 1 条"); expect(context).toContain("尺寸明细：总宽 6000 mm。");
  expect(context).not.toContain("materialCoverage"); expect(context).not.toContain("evidence.coverage.");
});
