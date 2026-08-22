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

// 成果种类（domain ArtifactKindSchema 十七值）。交付清单与成果列表不显示 drawingIr 一类原值。
export const ARTIFACT_KIND_LABELS: Record<string, string> = {
  ifc: "IFC 模型", glb: "三维模型", brepBundle: "实体几何包", geometryManifest: "几何清单",
  geometrySourceMap: "几何来源映射", geometryReport: "几何构建记录", geometryPreview: "几何预览",
  drawingIr: "图纸中间数据", viewGeometry: "视图几何", dxf: "成组图纸 DXF", svg: "图面预览 SVG",
  pdf: "成组图纸 PDF", png: "图面预览 PNG", drawingSourceMap: "图纸来源映射",
  checkReport: "检查记录", licenseManifest: "许可清单", deliveryManifest: "交付清单",
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

// 事实字段的中文名。字段标识来自演示包定义与动作层（documentedDimension.*、archetype.measured.*），
// 不是领域 schema 的枚举，所以这里只覆盖已知词汇；对不上的字段原样显示为标识（Geist），不另造词。
export const FACT_FIELD_LABELS: Record<string, string> = {
  moduleBaseZh: "模数基参", bayCount: "开间数", bayWidthMm: "开间尺寸", bayDepthMm: "进深尺寸",
  columnAxesXMm: "柱轴横向坐标", columnAxesYMm: "柱轴纵向坐标", purlinCount: "檩数", floorCount: "层数",
  bracketSetZh: "斗拱", columnMaterialZh: "柱材", frontPorchZh: "前廊", roofFormZh: "屋顶形式", structureSystemZh: "结构体系",
  "roofFrame.totalDepthMm": "通进深", "roofFrame.stepCount": "步架数",
  "documentedDimension.totalWidthMm": "资料记载总尺寸", "documentedDimension.segmentWidthsMm": "资料记载分段尺寸",
  "documentedDimension.measurementMetadataComplete": "测量记录完整性",
  "documentedDimension.overallWidthMm": "总宽", "documentedDimension.overallDepthMm": "总深",
  "documentedDimension.eaveHeightMm": "檐口高", "documentedDimension.ridgeHeightMm": "屋脊高", "documentedDimension.ridgeElevationMm": "屋脊标高",
  "documentedDimension.centralBayWidthMm": "中间开间宽", "documentedDimension.sideBayWidthMm": "边开间宽", "documentedDimension.totalFrontWidthMm": "正面总宽",
  "documentedDimension.alleywayWidthMm": "巷道宽", "documentedDimension.coveredAlleywayWidthMm": "有盖巷道宽", "documentedDimension.coveredWalkDepthMm": "檐廊进深",
  "documentedDimension.assumedColumnHeightMm": "假定柱高",
  "documentedDimension.scaledEaveElevationMm": "檐口标高（图上量取）", "documentedDimension.scaledFloorAboveGradeMm": "首层高出地坪（图上量取）",
  "documentedDimension.scaledSecondFloorElevationMm": "二层楼面标高（图上量取）",
};

export function factFieldLabel(field: string): string {
  if (FACT_FIELD_LABELS[field]) return FACT_FIELD_LABELS[field];
  const lift = field.match(/^liftRatio(\d+)$/);
  if (lift) return `举架系数 ${lift[1]}`;
  const measured = field.match(/^archetype\.measured\.(.+)$/);
  if (measured) return `${FACT_FIELD_LABELS[measured[1]!] ?? measured[1]}（实测）`;
  return field;
}

// 字段没有中文名时按标识显示，界面用 Geist 排
export const isFactFieldCode = (field: string): boolean => factFieldLabel(field) === field;
