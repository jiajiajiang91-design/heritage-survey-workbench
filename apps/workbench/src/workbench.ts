import { ProjectCommandService, type ProjectHead, type ProjectSummary } from "@gujian/application";
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
}): Promise<ProjectHead> {
  const projectId = crypto.randomUUID();
  const actorId = localActorId();
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
        id: crypto.randomUUID(),
        projectId,
        name: input.buildingName,
        periodText: null,
        addressText: input.locationText || null,
        status: "existing",
      },
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
  if (existing.length) return null;
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
    const [head, artifacts, checkRuns] = await Promise.all([
      projectRepository.getProjectHead(summary.projectId),
      projectRepository.getProjectArtifacts(summary.projectId),
      projectRepository.getProjectCheckRuns(summary.projectId),
    ]);
    const snapshot = head?.snapshot ?? null;
    const task = snapshot?.taskDefinitions.find((item) => item.confirmedAt !== null) ?? null;
    const scales = [...new Set((task?.artifactRequirements?.views ?? []).map((view) => `1:${view.scaleDenominator}`))];
    const geometrySpec = snapshot?.geometrySpecs.at(-1) ?? null;
    const checkedIds = new Set(checkRuns
      .filter((run) => run.results.every((result) => result.outcome === "passed"))
      .flatMap((run) => run.artifactRefs));
    const photo = snapshot?.evidences.find((item) => item.evidenceType === "photo" && item.dataStatus === "available") ?? null;
    // 封面：第一张可用照片；没有照片的项目（如参数化样板）用第一张图纸的 SVG 预览
    const coverSvg = artifacts.find((item) => item.kind === "svg") ?? null;
    const coverAssetId = photo?.assetId ?? coverSvg?.assetId ?? null;
    const coverUrl = coverAssetId
      ? await projectRepository.getAsset(coverAssetId).then((asset) => asset.content ? URL.createObjectURL(asset.content) : null).catch(() => null)
      : null;
    const signoff = snapshot?.reviewSignoffs.at(-1) ?? null;
    return {
      projectId: summary.projectId,
      name: summary.name,
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
      factCount: snapshot?.facts.length ?? 0,
      objectCount: geometrySpec?.objects.length ?? 0,
      artifactCount: artifacts.length,
      pendingCount: (snapshot?.issues.filter((item) => item.status === "open").length ?? 0)
        + (snapshot?.candidates.filter((item) => item.reviewStatus === "unreviewed").length ?? 0),
      checkedArtifactCount: artifacts.filter((item) => checkedIds.has(item.id)).length,
      demoLimitationZh: demoByProject.get(summary.projectId)?.limitationZh ?? null,
      coverUrl,
    };
  }));
  // 列表按项目建立时间升序：演示项目按各自的建立日期排，本机新建的排在后面
  return cards.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
