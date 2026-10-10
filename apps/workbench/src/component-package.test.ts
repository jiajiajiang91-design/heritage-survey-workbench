// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { IndexedDbProjectRepository, openWorkbenchDatabase, ProjectPackageService } from "@gujian/infrastructure";
import { componentFixture } from "./test/component-fixture";
import { commitGeometryFacts } from "./geometry-fact-service";
import { componentInputs } from "./component-input";
import { localActorId, projectCommands, projectRepository, projectPackages } from "./workbench";
const actor = crypto.randomUUID();
vi.stubGlobal("localStorage", { getItem: () => actor, setItem: () => undefined });

describe("构件输入包内恢复", () => {
  it("编辑保留旧输入，ZIP 导出并导入独立仓储后尺寸引用及原资料完整", async () => {
    const test = await componentFixture();
    const component = { ...test.component, dimensionBindings: [{ field: "sizeX" as const, sourceFactRef: test.dimension.id }] };
    const first = await commitGeometryFacts({ head: test.head, values: { components: [component], interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    const original = structuredClone(first.head!.snapshot.facts.at(-1)!);
    const changed = { ...component, displayNameZh: "修订后的内部测试墙" };
    const second = await commitGeometryFacts({ head: first.head!, values: { components: [changed], interfaces: [] }, actorId: localActorId(), commands: projectCommands, repository: projectRepository });
    expect(second.head!.snapshot.facts.find((fact) => fact.id === original.id)).toEqual(original);
    expect(componentInputs(second.head!.snapshot)).toEqual([changed]);
    const zip = await projectPackages.exportZip(test.head.projectId);
    const db = openWorkbenchDatabase("component-roundtrip-" + crypto.randomUUID());
    try {
      const repository = new IndexedDbProjectRepository(db);
      const packages = new ProjectPackageService(repository);
      const id = await packages.import(zip, "component.zip", actor);
      const restored = (await repository.getProjectHead(id))!;
      expect(componentInputs(restored.snapshot)).toEqual([changed]);
      expect(restored.snapshot.facts).toEqual(second.head!.snapshot.facts);
      expect(restored.snapshot.evidences).toEqual(second.head!.snapshot.evidences);
      expect((await repository.getAsset(restored.snapshot.evidences[0]!.assetId!)).content.size).toBeGreaterThan(0);
    } finally { (await db).close(); }
  });
});
