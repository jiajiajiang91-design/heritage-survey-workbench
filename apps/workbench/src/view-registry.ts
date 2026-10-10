import { Activity, Boxes, ClipboardList, History, Ruler, ShieldCheck } from "lucide-react";

// 视图注册表。id 是动作层与测试用的稳定标识，改名只改 label 不动 id。
// label 与 01_产品/03_界面与交互形态.md 表 2、表 3 逐行一致，由 stage-map.test.ts 锁住。
export const stages = [
  { id: "tasks", label: "任务设置", icon: ClipboardList },
  { id: "evidence", label: "资料清单" },
  { id: "preview", label: "预览核对" },
  { id: "measurements", label: "尺寸核对", icon: Ruler },
  { id: "objects", label: "构件清单", icon: Boxes },
  { id: "conditions", label: "现状记录" },
  { id: "issues", label: "问题队列" },
  { id: "geometry", label: "三维模型" },
  { id: "sheetStyle", label: "出图设置" },
  { id: "drawings", label: "图纸预览" },
  { id: "checks", label: "文件检查", icon: ShieldCheck },
  { id: "package", label: "成果导出" },
  { id: "candidates", label: "AI 调用与用量", icon: Activity },
  { id: "history", label: "修改历史", icon: History },
] as const;

// 按制作任务组织入口，保留既有视图标识供历史记录与助手使用。
export const journeyStages = [
  { id: "s01", label: "任务设置", views: ["tasks"] },
  { id: "s02", label: "资料与预览", views: ["evidence", "preview", "measurements"] },
  { id: "s04", label: "模型制作", views: ["objects", "geometry"] },
  { id: "s06", label: "图纸制作", views: ["sheetStyle", "drawings"] },
  { id: "s07", label: "检查与导出", views: ["checks", "package"] },
] as const;
export const auxiliaryViews = ["conditions", "issues"] as const;

// 项目级页面。不属于任何一栋建筑，进入后不显示左栏与助手栏，只有一栏内容。
export const projectPages = ["candidates", "history"] as const;

export type StageId = typeof stages[number]["id"];
export type JourneyStage = typeof journeyStages[number];

// 十二个工作视图的排序，供上一步下一步用。项目级页面不参与推进。
export const journeyViewOrder = journeyStages.flatMap((stage) => stage.views) as readonly StageId[];
export const projectPageIds = new Set<string>(projectPages);

// 各视图页头下的一句说明（v4 Page description），说的是这一屏核对什么，不写数据
export const STAGE_DESCRIPTIONS: Record<StageId, string> = {
  tasks: "设置本次建筑与目标成果，然后添加图纸、照片或尺寸记录。",
  evidence: "添加并选择已有资料，生成尺寸与构件的识别预览。",
  preview: "选择一条识别结果，对照右侧原件核对或修正，再用于模型制作。",
  measurements: "对照原件修正并保存尺寸，完成后返回预览。",
  objects: "依资料补齐参数，先预览待核对形体，核对保存后生成模型。",
  geometry: "查看已生成的模型；选中构件核对来源，修改参数后重新生成。",
  conditions: "只记录当前资料上可见的内容。不可见部位记为待复查，不写推断结论。",
  issues: "自动核对发现的问题列在这里，由你决定怎么处理。",
  sheetStyle: "设置视图、比例与图幅，从当前模型生成图纸。",
  drawings: "查看已生成图纸，下载 DXF 或 PDF。",
  checks: "检查当前模型或图纸文件，查看需要修正的问题。",
  package: "查看成果文件并导出项目包，保留原件、模型、图纸与制作记录。",
  candidates: "核对 AI 调用次数、token 用量、估算费用与项目内识别结果。",
  history: "每一次写入都留在这里，含时间、操作人、动作和改了什么。",
};

export const isStageId = (value: string): value is StageId => stages.some((stage) => stage.id === value);
export const stageLabel = (id: string): string => stages.find((stage) => stage.id === id)?.label ?? id;

// 左栏阶段的三态。点的颜色不能是唯一信息，读屏与鼠标悬停都要能拿到同一句话。
export const STAGE_TONE_LABELS = { current: "当前", done: "已有记录", todo: "未开始" } as const;
export type StageTone = keyof typeof STAGE_TONE_LABELS;

export interface StageState {
  readonly label: string;
  readonly tone: "done" | "active" | "idle";
}

// 每个视图自己有没有数据。只看本视图，不预设完成度，也不按序推进。
export interface StageStateInput {
  readonly taskConfirmed: boolean;
  readonly evidenceCount: number;
  readonly factCount: number;
  readonly previewCount?: number;
  readonly objectCount: number;
  readonly observationCount: number;
  readonly openIssueCount: number;
  readonly hasGeometryRevision: boolean;
  readonly sheetCount: number | null;
  readonly drawingArtifactCount: number;
  readonly hasCheckRun: boolean;
  readonly hasDelivery: boolean;
  readonly modelRunCount: number;
  readonly changeCount: number;
  // 有复核签发记录时，空着的现状记录按已完成显示：签发即认定现状核对完毕，没有要记的问题
  readonly signedOff: boolean;
}

export function deriveStageStates(input: StageStateInput): Record<StageId, StageState> {
  return {
    tasks: input.taskConfirmed ? { label: "已确认", tone: "done" } : { label: "待确认", tone: "active" },
    evidence: input.evidenceCount ? { label: `${input.evidenceCount} 份`, tone: "done" } : { label: "无资料", tone: "idle" },
    preview: input.previewCount ? { label: input.previewCount + " 条结果", tone: "done" } : { label: "未生成预览", tone: "idle" },
    measurements: input.factCount ? { label: `${input.factCount} 条尺寸`, tone: "done" } : { label: "无尺寸记录", tone: "idle" },
    objects: input.objectCount ? { label: `${input.objectCount} 个对象`, tone: "done" } : { label: "无对象", tone: "idle" },
    conditions: input.observationCount
      ? { label: `${input.observationCount} 条记录`, tone: "done" }
      : input.signedOff ? { label: "无现状问题", tone: "done" } : { label: "无记录", tone: "idle" },
    issues: input.openIssueCount ? { label: `${input.openIssueCount} 项待办`, tone: "active" } : { label: "无待办", tone: "done" },
    geometry: input.hasGeometryRevision ? { label: "已生成", tone: "done" } : { label: "未生成", tone: "idle" },
    sheetStyle: input.sheetCount !== null ? { label: `${input.sheetCount} 张图幅`, tone: "done" } : { label: "未设置", tone: "idle" },
    drawings: input.drawingArtifactCount ? { label: `${input.drawingArtifactCount} 项产物`, tone: "done" } : { label: "未生成", tone: "idle" },
    checks: input.hasCheckRun ? { label: "已检查", tone: "done" } : { label: "未检查", tone: "idle" },
    package: input.hasDelivery ? { label: "已建草案", tone: "done" } : { label: "未建立", tone: "idle" },
    candidates: input.modelRunCount ? { label: `${input.modelRunCount} 次运行`, tone: "done" } : { label: "未运行", tone: "idle" },
    history: input.changeCount ? { label: `${input.changeCount} 次写入`, tone: "done" } : { label: "无记录", tone: "idle" },
  };
}

// 阶段显示当前、已有记录或未开始；已有记录不表示任务完成。
// 不是按序推进：本产品允许资料先到、现状后补，后面的阶段可能已经有数据而前面的还空着。
export function journeyTone(
  views: readonly string[],
  activeStage: StageId,
  stageStates: Record<StageId, StageState>,
): { tone: StageTone; detail: string } {
  const detail = views.map((view) => stageStates[view as StageId].label).join(" · ");
  if (views.includes(activeStage)) return { tone: "current", detail };
  const done = views.some((view) => { const state = stageStates[view as StageId]; return state.tone === "done" && view !== "issues" || state.tone === "active" && view !== "tasks"; });
  return { tone: done ? "done" : "todo", detail };
}

export interface PendingItem {
  readonly label: string;
  readonly count: number;
  readonly hint: string;
  readonly stage: StageId;
}

// 待办（05 图 1 左栏）：按原因分条列出，不合并成一个数字
export function derivePendingItems(openIssues: readonly { issueType: string }[]): PendingItem[] {
  const count = (type: string) => openIssues.filter((issue) => issue.issueType === type).length;
  const groups: PendingItem[] = [
    { label: "需专业判断", count: count("professionalUncertainty"), hint: "不止一种专业判断，需要人工决定", stage: "issues" },
    { label: "缺现场资料", count: count("missingEvidence"), hint: "补入资料后自动重新核对", stage: "evidence" },
    { label: "数据对不上", count: count("ruleConflict"), hint: "尺寸之间或与做法对不上", stage: "issues" },
  ];
  return groups.filter((item) => item.count > 0);
}
