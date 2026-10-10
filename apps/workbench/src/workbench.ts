import { processStoredEvidence } from "./evidence-processing";
import { evidenceReadability } from "./evidence-readability";
import { describeFailure } from "./failure-notice";
import { taskFromProduction, type ProductionTaskValues, type PreparedFile } from "./production-task";
import { currentDimensionCount, pendingDimensionCount } from "./dimension-review";
import { ProjectCommandService, type ProjectHead, type ProjectSummary } from "@gujian/application";
import { artifactOutputUnitMatches, outputUnitUpdateState } from "@gujian/domain";
import {
  CadJobClient, DeliveryService, DrawingJobClient, EvidenceIngestionService,
  IndexedDbProjectRepository, LocalAuthorization, ProjectPackageService, WorkflowService,
} from "@gujian/infrastructure";

import { listDemoLibraryUpdates, loadDemoLibrary, readDemoLibraryManifest, type DemoLibraryUpdate, type DemoLoadResult } from "./demo-library-loader";
import { ModelRunClient } from "./model-run-client";

export const projectRepository = new IndexedDbProjectRepository();
export const projectCommands = new ProjectCommandService({
  repository: projectRepository,
  authorization: new LocalAuthorization(),
});
export const projectPackages = new ProjectPackageService(projectRepository);
export const evidenceIngestion = new EvidenceIngestionService(projectRepository);
export const modelRuns = new ModelRunClient({ repository: projectRepository, commands: projectCommands });
export const cadJobs = new CadJobClient({ repository: projectRepository, commands: projectCommands });
export const drawingJobs = new DrawingJobClient({ repository: projectRepository, commands: projectCommands });
export const deliveries = new DeliveryService({ repository: projectRepository, commands: projectCommands });
export const workflow = new WorkflowService(projectRepository);

const ACTOR_KEY = "gujian-workbench-v3:local-actor-id";

export function localActorId(): string {
  const existing = localStorage.getItem(ACTOR_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(ACTOR_KEY, created);
  return created;
}

export async function createLocalProject(input: {
  name: string;
  buildingName: string;
  locationText: string;
  production?: ProductionTaskValues;
}): Promise<ProjectHead> {
  const projectId = crypto.randomUUID();
  const actorId = localActorId();
  const buildingId = crypto.randomUUID();
  const now = new Date().toISOString();
  await projectCommands.execute({
    commandType: "CreateProject",
    commandId: crypto.randomUUID(),
    projectId,
    actorId,
    expectedRevisionId: null,
    issuedAt: now,
    payload: {
      project: {
        id: projectId,
        name: input.name,
        status: "active",
        locationText: input.locationText || null,
        createdAt: now,
      },
      building: {
        id: buildingId,
        projectId,
        name: input.buildingName,
        periodText: null,
        ...(input.production ? { buildingType: input.production.buildingType.trim() || null, mainStructure: input.production.mainStructure.trim() || null } : {}),
        addressText: input.locationText || null,
        status: "existing",
      },
      ...(input.production ? { taskDefinition: taskFromProduction(input.production, buildingId, actorId) } : {}),
    },
  });
  const head = await projectRepository.getProjectHead(projectId);
  if (!head) throw new Error("项目创建后未能读取");
  return head;
}

export async function listLocalProjects(): Promise<readonly ProjectSummary[]> {
  return projectRepository.listProjects();
}

// 首次打开的装载策略放在组合根，不放在组件里。
// 组件自行发起的异步写入没有办法被调用方等待，测试里会与断言竞争。
// 返回 null 表示本地已有项目，没有装载动作。
export async function bootstrapDemoProjects(): Promise<DemoLoadResult | null> {
  const existing = await listLocalProjects();
  if (existing.length) {
    const manifest = await readDemoLibraryManifest().catch(() => null);
    if (!manifest) return null;
    const existingIds = new Set(existing.map((item) => item.projectId));
    // 只在本机已经有展示项目时补齐缺少的展示项目。纯用户项目库不自动加入展示内容。
    if (!manifest.projects.some((entry) => existingIds.has(entry.projectId))) return null;
  }
  return loadDemoLibrary({
    packages: projectPackages,
    existingProjectIds: new Set(existing.map((item) => item.projectId)),
    actorId: localActorId(),
  });
}

// 本机上的演示项目有没有新版本的包（实施单元 09）。有就由列表页提示，用户点更新后清空重装。
export async function checkDemoLibraryUpdates(): Promise<DemoLibraryUpdate[]> {
  const existing = await listLocalProjects();
  if (!existing.length) return [];
  return listDemoLibraryUpdates({ existingProjectIds: new Set(existing.map((item) => item.projectId)) });
}

// 项目列表页的卡片数据。项目摘要只有名称与状态，卡片要的计数与范围在快照里，
// 这里逐个项目读头与检查记录算出来，口径按裁决记录第三节第 5 条：
// 待确认取问题队列未解决项与候选待确认项之和，可导出成果取通过检查的成果数。
export interface ProjectCard {
  readonly outputUnitPending?: boolean;
  readonly projectId: string;
  readonly name: string;
  readonly buildingName: string;
  readonly status: "active" | "archived";
  readonly updatedAt: string;
  readonly createdAt: string;
  // 复核签发时间；没有签发记录时为 null，卡片显示进行中
  readonly signedAt: string | null;
  readonly taskName: string | null;
  readonly scaleLabel: string | null;
  readonly locationText: string | null;
  readonly evidenceCount: number;
  readonly photoCount: number;
  readonly drawingCount: number;
  readonly factCount: number;
  readonly objectCount: number;
  readonly artifactCount: number;
  readonly pendingCount: number;
  readonly checkedArtifactCount: number;
  // 演示库清单里的适用边界；普通本机项目为 null。
  readonly demoLimitationZh: string | null;
  // 有可用照片时给封面用的对象地址；没有照片时为 null，卡片改显示资料构成
  readonly coverUrl: string | null;
}

export async function listProjectCards(): Promise<readonly ProjectCard[]> {
  const [summaries, demoManifest] = await Promise.all([
    listLocalProjects(),
    readDemoLibraryManifest().catch(() => null),
  ]);
  const demoByProject = new Map((demoManifest?.projects ?? []).map((entry) => [entry.projectId, entry]));
  const cards = await Promise.all(summaries.map(async (summary) => {
    const [head, artifacts, checkRuns, matrices] = await Promise.all([
      projectRepository.getProjectHead(summary.projectId),
      projectRepository.getProjectArtifacts(summary.projectId),
      projectRepository.getProjectCheckRuns(summary.projectId),
      projectRepository.getProjectArtifactRequirementMatrices(summary.projectId),
    ]);
    const snapshot = head?.snapshot ?? null;
    const task = snapshot?.taskDefinitions.find((item) => item.confirmedAt !== null) ?? null;
    const scales = [...new Set((task?.artifactRequirements?.views ?? []).map((view) => `1:${view.scaleDenominator}`))];
    const geometrySpec = snapshot?.geometrySpecs.at(-1) ?? null;
    const geometry = snapshot?.geometryRevisions.at(-1);
    const currentArtifacts = snapshot ? artifacts.filter((item) => item.geometryRevisionId === geometry?.id && artifactOutputUnitMatches(snapshot, item, matrices)) : [];
    const unitUpdate = snapshot ? outputUnitUpdateState(snapshot, artifacts, matrices) : { model: false, drawings: false };
    const outputUnitPending = unitUpdate.model || unitUpdate.drawings;
    const checkedIds = new Set(checkRuns
      .filter((run) => run.geometryRevisionId === geometry?.id && run.artifactRefs.every((ref) => currentArtifacts.some((item) => item.id === ref)) && run.results.every((result) => result.outcome === "passed"))
      .flatMap((run) => run.artifactRefs));
    const signoff = !outputUnitPending ? snapshot?.reviewSignoffs.find((item) => item.geometryRevisionId === geometry?.id) ?? null : null;
    return {
      projectId: summary.projectId,
      name: task?.productionSetup?.projectGroup ?? summary.name,
      buildingName: summary.buildingName,
      status: summary.status,
      updatedAt: summary.updatedAt,
      createdAt: snapshot?.project.createdAt ?? summary.updatedAt,
      signedAt: signoff?.signedAt ?? null,
      taskName: task?.name ?? null,
      scaleLabel: scales.length ? scales.join("、") : null,
      locationText: snapshot?.project.locationText ?? null,
      evidenceCount: snapshot?.evidences.length ?? 0,
      photoCount: snapshot?.evidences.filter((item) => item.evidenceType === "photo").length ?? 0,
      drawingCount: snapshot?.evidences.filter((item) => item.evidenceType === "drawing").length ?? 0,
      factCount: snapshot ? currentDimensionCount(snapshot) : 0,
      objectCount: geometrySpec?.objects.length ?? 0,
      artifactCount: currentArtifacts.length,
      outputUnitPending,
      pendingCount: Number(outputUnitPending) + (snapshot?.issues.filter((item) => item.status === "open").length ?? 0)
        + (snapshot?.candidates.filter((item) => item.reviewStatus === "unreviewed" && item.structured?.kind !== "measurementTranscription").length ?? 0)
        + (snapshot ? pendingDimensionCount(snapshot) : 0),
      checkedArtifactCount: currentArtifacts.filter((item) => checkedIds.has(item.id)).length,
      demoLimitationZh: demoByProject.get(summary.projectId)?.limitationZh ?? null,
      coverUrl: null,
    };
  }));
  // 列表按项目建立时间升序：演示项目按各自的建立日期排，本机新建的排在后面
  return cards.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function saveProductionTask(head: ProjectHead, values: ProductionTaskValues): Promise<ProjectHead> {
  const current = head.snapshot.taskDefinitions.find((t) => t.confirmedAt !== null);
  const building = head.snapshot.buildings.find((b) => b.id === current?.productionSetup?.buildingId) ?? head.snapshot.buildings[0]!;
  const task = taskFromProduction(values, building.id, localActorId(), current);
  const payload = { taskDefinition: task, building: { ...building, name: values.buildingName.trim(), buildingType: values.buildingType.trim() || null, mainStructure: values.mainStructure.trim() || null } };
  const header = { commandId: crypto.randomUUID(), projectId: head.projectId, actorId: localActorId(), expectedRevisionId: head.revisionId, issuedAt: new Date().toISOString() };
  await projectCommands.execute(current
    ? { ...header, commandType: "ReplaceTaskDefinition", payload: { ...payload, supersedesTaskDefinitionId: current.id } }
    : { ...header, commandType: "ConfirmTaskSetup", payload });
  const saved = await projectRepository.getProjectHead(head.projectId);
  if (!saved) throw new Error("任务保存后未能读取，请重新进入任务。");
  return saved;
}
export async function prepareEvidenceFiles(head: ProjectHead, files: readonly PreparedFile[], onProcessing?: (head: ProjectHead, evidenceId: string | null) => void) {
  let current = head;
  const failures: string[] = [];
  for (const entry of files) {
    try {
      current = await evidenceIngestion.ingest(current, localActorId(), entry.file, entry.level);
      const evidenceId = current.snapshot.evidences.at(-1)!.id;
      onProcessing?.(current, evidenceId);
      if (/\.tiff?$/i.test(entry.file.name) || entry.file.type === "image/tiff") current = await processStoredEvidence({ repository: projectRepository, commands: projectCommands, head: current, actorId: localActorId(), evidenceId });
      const readable = evidenceReadability(current.snapshot, evidenceId);
      if (readable.state !== "readable") failures.push(entry.file.name + "：" + readable.detail);
    }
    catch (reason) {
      failures.push(entry.file.name + "：" + describeFailure(reason, "保存失败").summaryZh);
      current = await projectRepository.getProjectHead(head.projectId) ?? current;
    }
  }
  onProcessing?.(current, null);
  return { head: current, failures };
}
