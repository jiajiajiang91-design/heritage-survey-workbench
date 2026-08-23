// 资格与阻断说明：界面上出现的资格限制、阻断原因都从这里取词。
// 原来常驻标签只写了签发状态一层，成果等级、使用禁区、身份性质三层
// 只写在交付草案的 restrictions 与图纸图签上，界面比图纸说得少。

export interface QualificationLimit {
  code: string;
  layerZh: string;
  textZh: string;
}

// 三条与 delivery-service 的 FORMAL_ONLY_CODES 一一对应，
// 也与图纸图签上印的代理成果、未签发、未经专业复核不可用于正式交付或施工同源。
export const QUALIFICATION_LIMITS: readonly QualificationLimit[] = [
  {
    code: "L1_ELIGIBILITY_FALSE",
    layerZh: "成果等级",
    textZh: "不作为专业样板或参照标准使用。",
  },
  {
    code: "PROFESSIONAL_REVIEW_REQUIRED",
    layerZh: "使用禁区",
    textZh: "未经项目责任人员复核，不可用于正式交付、施工与法定档案入库。",
  },
  {
    code: "FORMAL_SIGNOFF_UNAVAILABLE",
    layerZh: "身份性质",
    textZh: "本机身份不具备签发资格，签发须由项目责任人员在正式环境完成。",
  },
];

export const QUALIFICATION_CHIP_LABEL = "待签发成果 · 未签发 · 不作为样板";
// 有复核签发记录时的成果状态（实施单元 09）
export const SIGNED_CHIP_LABEL = "已签发成果 · 可正式交付";

const ISSUE_TYPE_ZH: Record<string, string> = {
  missingEvidence: "缺资料",
  ruleConflict: "数据对不上",
  professionalUncertainty: "需专业判断",
  highRisk: "高风险",
};

// 检查项的名字写成检查的内容，不写成失败的样子：通过时显示"图纸与生成记录一致 通过"，
// 不通过时由 describeBlocker 加"检查不通过："前缀
const CHECK_CODE_ZH: Record<string, string> = {
  PROFESSIONAL_REVIEW_REQUIRED: "专业复核",
  FORMAL_SIGNOFF_UNAVAILABLE: "正式签发",
  L1_ELIGIBILITY_FALSE: "专业样板等级",
  DRAWING_OUTPUT_HASH_CLOSURE: "图纸与生成记录一致",
  UNVERIFIED_DIMENSION_CANDIDATES: "尺寸核验",
  MEASUREMENT_METADATA_MISSING: "测量记录的测量人、时间与方法",
  GEOMETRY_EVIDENCE_FACTS_MISSING: "三维模型的实测依据",
};

// 不能正式交付的原因：交付评估写的是 CODE 或 CODE:细节:UUID 形态，直出会把
// 内部码和 UUID 漏到界面（07 界面视觉规范 5.6）。
// 检查项的中性名字，供检查结果列表做标题；不带通过与否的判断词
export function checkItemLabel(code: string): string {
  return CHECK_CODE_ZH[code] ?? describeBlocker(code);
}

export function describeBlocker(code: string): string {
  if (CHECK_CODE_ZH[code]) return `${CHECK_CODE_ZH[code]}未通过`;
  if (ISSUE_TYPE_ZH[code]) return ISSUE_TYPE_ZH[code]!;

  const [head = "", second = ""] = code.split(":");
  if (head === "OPEN_ISSUE") return `未处理事项：${ISSUE_TYPE_ZH[second] ?? "需人工判断"}`;
  if (head === "CHECK_BLOCKED") return `检查不通过：${CHECK_CODE_ZH[second] ?? "详见检查结果"}`;
  if (head === "UNKNOWN") return "有待确认部位，详见三维模型";
  if (head === "PROJECT_INPUT_BLOCKED") return "项目输入数据不完整";
  return "还有不通过的项，详见检查结果与问题队列";
}
