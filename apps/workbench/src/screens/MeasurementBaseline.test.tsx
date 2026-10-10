import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MeasurementBaseline } from "./MeasurementBaseline";
import { componentFixture } from "../test/component-fixture";
import { commitMaterialCoverage } from "../material-coverage";
import { localActorId, projectCommands, projectRepository } from "../workbench";
import type { EvidencePane } from "../workbench/useEvidencePane";
afterEach(cleanup);
it("资料覆盖及清空保留在资料页，不进入尺寸表", async () => {
  const test = await componentFixture(); const evidenceId = test.head.snapshot.evidences[0]!.id;
  const head = await commitMaterialCoverage({ head: test.head, evidenceId, entries: [], actorId: localActorId(), commands: projectCommands, repository: projectRepository });
  const pane: EvidencePane = { activeEvidenceId: evidenceId, setActiveEvidenceId: vi.fn(), activeEvidenceTitle: "内部原件", evidencePreview: null, imageSelection: null, setImageSelection: vi.fn(), downloadEvidence: vi.fn() };
  const view = render(<MeasurementBaseline snapshot={head.snapshot} pane={pane} archetypes={[]} evidenceTitle={() => "内部原件"}
    onRegisterArchetype={vi.fn()} onReviewDimensions={vi.fn()} onConfirmDimensionChain={vi.fn()} />);
  expect(screen.getByText("尺寸与记录 · 1 条")).toBeInTheDocument();
  expect(view.container.querySelector(".sc-measure-table")).toHaveTextContent("6000 mm");
  expect(view.container.querySelector(".sc-measure-table")).not.toHaveTextContent("materialCoverage");
  expect(view.container.querySelector(".sc-measure-table")).not.toHaveTextContent("evidence.coverage.");
});
