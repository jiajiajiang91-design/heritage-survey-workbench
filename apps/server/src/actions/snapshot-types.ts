import { z } from "zod";

// 工作区状态快照：客户端随每次助手请求上送，服务端据此求值前置条件。
// 项目数据在浏览器 IndexedDB，服务端无项目状态，这是唯一的状态来源。
// 字段全部可选：缺失字段由前置条件按"不满足"处理（fail-closed），而不是拒收请求。
export const WorkspaceSnapshotSchema = z.object({
  projectId: z.uuid().nullable().optional(),
  currentStage: z.string().min(1).max(60).optional(),
  openDockItems: z.number().int().nonnegative().optional(),
  componentCount: z.number().int().nonnegative().optional(),
  hasGeometryRevision: z.boolean().optional(),
  hasDrawings: z.boolean().optional(),
  hasDeliverable: z.boolean().optional(),
  modelRouteAvailable: z.boolean().optional(),
  unparsedEvidenceCount: z.number().int().nonnegative().optional(),
  // 用户当前是否在某张证据图片上框了一个位置。框选修正的前置条件，
  // 也是模型可见目录里该动作是否可选的依据。
  hasImageSelection: z.boolean().optional(),
  // 项目上下文（实施单元 09）：客户端按真实数据写成的一段中文，含项目、资料、尺寸、问题、模型、图纸、
  // 检查与签发的现状。回答问题与生成建议只依据它，模型不得补写里面没有的数字。
  contextZh: z.string().max(8_000).optional(),
}).strict();

export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
