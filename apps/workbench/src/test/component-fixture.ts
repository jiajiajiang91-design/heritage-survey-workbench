import { dimensionFixture } from "./dimension-fixture";
import { commitDimensionReviews } from "../dimension-review";
import { localActorId, projectCommands, projectRepository } from "../workbench";
import type { ComponentInput } from "../component-input";

export async function componentFixture() {
  const source = await dimensionFixture();
  const saved = await commitDimensionReviews({ head: source.head, candidate: source.candidate,
    drafts: [{ rowIndex: 0, disposition: "adopt", name: "总宽", valueMm: "6000", checked: true, reason: "" }],
    actorId: localActorId(), commands: projectCommands, repository: projectRepository });
  const head = saved.head!;
  const component: ComponentInput = {
    stableKey: crypto.randomUUID(), displayNameZh: "内部测试墙", componentType: "wall", materialCode: "brick",
    parentStableKey: null, sourceLocation: "内部测试资料第 1 行", evidenceRefs: [head.snapshot.evidences[0]!.id],
    solid: { kind: "box", sizeX: "6000", sizeY: "240", sizeZ: "3000", centerMm: [3000, 120, 1500] },
    positionBasis: "human", conceptRef: "wall-test", parameters: [], unknowns: [],
  };
  return { ...source, head, component, dimension: head.snapshot.facts[0]! };
}
