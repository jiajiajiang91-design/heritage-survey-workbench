// 界面只出现日常语言：来源、状态一律用中文，不显示英文枚举值。
// 各表的键必须与领域 schema 的取值一一对应，缺键会让英文原值漏到界面，
// 由 label-coverage.test.ts 锁住。核心 PRD 附录 A.4：界面状态词一律取这里的取值。

export const PRODUCER_LABELS: Record<string, string> = {
  model: "AI 识别", human: "人工确认", rule: "自动核对", demo: "示例资料",
};

// 记录级构件的来源。框选新增与识别确认写的是同一类记录，来源必须分得开：
// 一个是人在图上圈出来的，一个是模型认出来再由人确认的。
export const ENTITY_ORIGIN_LABELS: Record<string, string> = {
  marquee: "框选新增", recognition: "识别确认", import: "随包导入",
};

export const REVIEW_LABELS: Record<string, string> = {
  unreviewed: "待确认", confirmed: "已确认", rejected: "已驳回", superseded: "已被替代",
};

// 存疑是本产品最需要显性表达的状态，缺它等于把不确定当成可用
export const DATA_STATUS_LABELS: Record<string, string> = {
  available: "可用", uncertain: "存疑", missing: "缺失", stale: "已过期",
};

export const PARSE_STATUS_LABELS: Record<string, string> = {
  parsed: "已读取文字内容", failed: "无法自动读取", metadataOnly: "仅登记，未读取内容", pending: "待读取",
};

export const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  photo: "照片", document: "文档", drawing: "图纸", measurementRecord: "测量记录",
  audio: "录音", video: "视频", pointCloud: "点云", other: "其他",
};

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  missingEvidence: "缺资料", professionalUncertainty: "需专业判断",
  ruleConflict: "数据对不上", highRisk: "高风险",
};

export const OBSERVATION_LABELS: Record<string, string> = {
  visibleCondition: "可见状态", damage: "残损", material: "材料", state: "整体状态",
};

export const LIFT_RATIO_SET_LABELS: Record<string, string> = {
  "qing-gongcheng-zuofa": "清工程做法举架系数",
  "liang-drawings": "梁思成图纸举架系数",
};

export const DRAWING_KIND_LABELS: Record<string, string> = {
  floorPlan: "平面", roofPlan: "屋顶平面", elevation: "立面",
  transverseSection: "横剖", longitudinalSection: "纵剖", axonometric: "轴测", detail: "详图",
};

// 作业阶段的中文说法。界面不显示 queued、running 一类原值。
export const JOB_PHASE_LABELS: Record<string, string> = {
  queued: "排队中", running: "运行中", succeeded: "已完成", failed: "已失败",
  cancelled: "已取消", late: "结果已作废",
};

export function cadPhaseLabel(phase: string | undefined | null): string {
  return phase ? JOB_PHASE_LABELS[phase] ?? "运行中" : "排队中";
}

// 任务书责任角色。操作人没有姓名字段时按角色显示（裁决记录第三节第 8 条）。
export const RESPONSIBILITY_ROLE_LABELS: Record<string, string> = {
  projectLead: "项目负责人", surveyor: "测绘人", professionalReviewer: "复核人", archiveRecipient: "档案接收方",
};
