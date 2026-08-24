import { Activity, Boxes, ClipboardList, History, Ruler, ShieldCheck } from "lucide-react";

// 视图注册表。id 是动作层与测试用的稳定标识，改名只改 label 不动 id。
// label 与 01_产品/03_界面与交互形态.md 表 2、表 3 逐行一致，由 stage-map.test.ts 锁住。
export const stages = [
  { id: "tasks", label: "任务卡", icon: ClipboardList },
  { id: "evidence", label: "资料清单" },
  { id: "measurements", label: "实测基准", icon: Ruler },
  { id: "objects", label: "构件清单", icon: Boxes },
  { id: "conditions", label: "现状记录" },
  { id: "issues", label: "问题队列" },
  { id: "geometry", label: "三维模型" },
  { id: "sheetStyle", label: "图纸样式" },
  { id: "drawings", label: "成组图纸" },
  { id: "checks", label: "检查与签发", icon: ShieldCheck },
  { id: "package", label: "成果归档" },
  { id: "candidates", label: "模型运行与用量", icon: Activity },
  { id: "history", label: "修改历史", icon: History },
] as const;

// 八个任务阶段，对应用户旅程的八步。左栏按阶段走，不平铺视图。
// 阶段与视图是一对多：核对构件、记录现状、生成图纸各含两个视图，其余各一个。
// 视图在数组里的先后就是阶段内的页签顺序，也是下一步的推进顺序。
export const journeyStages = [
  { id: "s01", label: "建立任务", views: ["tasks"] },
  { id: "s02", label: "整理资料", views: ["evidence"] },
  { id: "s03", label: "核对实测", views: ["measurements"] },
  { id: "s04", label: "核对构件", views: ["objects", "geometry"] },
  { id: "s05", label: "记录现状", views: ["conditions", "issues"] },
  { id: "s06", label: "生成图纸", views: ["sheetStyle", "drawings"] },
  { id: "s07", label: "检查签发", views: ["checks"] },
  { id: "s08", label: "交付归档", views: ["package"] },
] as const;

// 项目级页面。不属于任何一栋建筑，进入后不显示左栏与助手栏，只有一栏内容。
export const projectPages = ["candidates", "history"] as const;

export type StageId = typeof stages[number]["id"];
export type JourneyStage = typeof journeyStages[number];

// 十一个工作视图的排序，供上一步下一步用。项目级页面不参与推进。
export const journeyViewOrder = journeyStages.flatMap((stage) => stage.views) as readonly StageId[];
export const projectPageIds = new Set<string>(projectPages);

// 各视图页头下的一句说明（v4 Page description），说的是这一屏核对什么，不写数据
export const STAGE_DESCRIPTIONS: Record<StageId, string> = {
  tasks: "确认对象、范围、成果要求和资料前提。",
  evidence: "按来源和可用状态核对每份资料；缺失的资料照样登记，不隐藏。",
  measurements: "核对每条尺寸的来源；待核实与实测分开记。",
  objects: "逐个核对构件的名称、位置和对应照片。",
  geometry: "模型里的每个构件都由本项目资料生成，可回溯到来源。",
  conditions: "只记录当前资料上可见的内容。不可见部位记为待复查，不写推断结论。",
  issues: "自动核对发现的问题列在这里，由你决定怎么处理。",
  sheetStyle: "图种、图幅和版面来自任务要求；图上每条线都由当前三维模型剖切或投影得到，不另外描画。",
  drawings: "按任务要求出图，DXF、PDF 与预览图同源。",
  checks: "自动检查的结果和复核签发的状态都在这里。",
  package: "成果包含图纸、模型、检查结果与来源说明；签发后可正式交付。",
  candidates: "按用量与公开单价算费用。",
  history: "每一次写入都留在这里，含时间、操作人、动作和改了什么。",
};

export const isStageId = (value: string): value is StageId => stages.some((stage) => stage.id === value);
export const stageLabel = (id: string): string => stages.find((stage) => stage.id === id)?.label ?? id;

// 左栏阶段的三态。点的颜色不能是唯一信息，读屏与鼠标悬停都要能拿到同一句话。
export const STAGE_TONE_LABELS = { current: "当前", done: "已完成", todo: "未开始" } as const;
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

// 阶段三态：当前、已完成、未开始。一个阶段含多个视图时，全部视图完成才算完成。
// 不是按序推进：本产品允许资料先到、现状后补，后面的阶段可能已经有数据而前面的还空着。
export function journeyTone(
  views: readonly string[],
  activeStage: StageId,
  stageStates: Record<StageId, StageState>,
): { tone: StageTone; detail: string } {
  const detail = views.map((view) => stageStates[view as StageId].label).join(" · ");
  if (views.includes(activeStage)) return { tone: "current", detail };
  const done = views.every((view) => stageStates[view as StageId].tone === "done");
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
