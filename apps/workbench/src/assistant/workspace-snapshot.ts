// 工作区状态快照构造：只送计数与有无标记，不送全量事实。
// 与服务端 apps/server/src/actions/snapshot-types.ts 的契约一致。
export interface WorkspaceSnapshot {
  projectId: string | null;
  currentStage: string;
  openDockItems: number;
  componentCount: number;
  hasGeometryRevision: boolean;
  hasDrawings: boolean;
  hasDeliverable: boolean;
  modelRouteAvailable: boolean;
  unparsedEvidenceCount: number;
  // 用户当前是否在某张资料图片上框了位置
  hasImageSelection: boolean;
  // 项目现状的一段中文（实施单元 09）：按真实数据写成，回答问题与生成建议只依据它
  contextZh?: string;
}

export interface SnapshotInput {
  projectId: string | null;
  currentStage: string;
  openIssueCount: number;
  entityCount: number;
  geometryRevisionCount: number;
  artifactCount: number;
  deliveryCount: number;
  serverModelConfigured: boolean;
  unparsedEvidenceCount: number;
  hasImageSelection: boolean;
  contextZh?: string;
}

export function buildWorkspaceSnapshot(input: SnapshotInput): WorkspaceSnapshot {
  return {
    projectId: input.projectId,
    currentStage: input.currentStage,
    openDockItems: Math.max(0, input.openIssueCount),
    componentCount: Math.max(0, input.entityCount),
    hasGeometryRevision: input.geometryRevisionCount > 0,
    hasDrawings: input.artifactCount > 0,
    hasDeliverable: input.deliveryCount > 0,
    modelRouteAvailable: input.serverModelConfigured,
    unparsedEvidenceCount: Math.max(0, input.unparsedEvidenceCount),
    hasImageSelection: input.hasImageSelection === true,
    ...(input.contextZh ? { contextZh: input.contextZh.slice(0, 8_000) } : {}),
  };
}
