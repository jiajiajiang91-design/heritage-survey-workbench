import { TaskDefinitionSchema, type ProductionSetup } from "@gujian/domain";
import type { ProjectHead } from "@gujian/application";

export const TARGET_LABELS = { model: "主体模型", floorPlan: "首层平面", elevation: "指定立面", section: "指定剖面" } as const;
export const UNIT_LABELS = { mm: "毫米", cm: "厘米", m: "米" } as const;
export const LEVEL_LABELS = { required: "必需", recommended: "建议", additional: "额外补充" } as const;
export type PreparationLevel = keyof typeof LEVEL_LABELS;
export interface PreparedFile { file: File; level: PreparationLevel }
export interface ProductionTaskValues {
  taskName: string; buildingName: string; purpose: ProductionSetup["purpose"]; outputUnit: ProductionSetup["outputUnit"];
  targets: ProductionSetup["targets"]; projectGroup: string; buildingType: string; mainStructure: string;
}
export const emptyProductionTask = (): ProductionTaskValues => ({ taskName: "", buildingName: "", purpose: "existingSurvey", outputUnit: "mm",
  targets: ["model", "floorPlan"], projectGroup: "", buildingType: "", mainStructure: "" });
export function productionErrors(value: ProductionTaskValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!value.taskName.trim() || value.taskName.trim().length > 200) errors.taskName = "请填写 1 至 200 字的任务名称。";
  if (!value.buildingName.trim() || value.buildingName.trim().length > 200) errors.buildingName = "请填写 1 至 200 字的建筑名称。";
  if (!value.targets.length) errors.targets = "请选择至少一项目标成果。";
  for (const key of ["projectGroup", "buildingType", "mainStructure"] as const) if (value[key].length > 200) errors[key] = "最多填写 200 字。";
  return errors;
}
export function taskFromProduction(values: ProductionTaskValues, buildingId: string, actorId: string, current?: ProjectHead["snapshot"]["taskDefinitions"][number]) {
  return TaskDefinitionSchema.parse({ ...current, id: crypto.randomUUID(), name: values.taskName.trim(),
    scope: current?.scope ?? ["根据已有资料制作现状测绘成果"], regulationRefs: current?.regulationRefs ?? [],
    deliverables: values.targets.map((target) => TARGET_LABELS[target]),
    responsibilities: current?.responsibilities ?? [{ role: "surveyor", actorId }], automationPolicyRef: current?.automationPolicyRef ?? null,
    productionSetup: { buildingId, purpose: values.purpose, outputUnit: values.outputUnit, targets: values.targets, projectGroup: values.projectGroup.trim() || null },
    confirmedAt: new Date().toISOString(),
  });
}
export function readProductionTask(head: ProjectHead["snapshot"]): ProductionTaskValues {
  const task = head.taskDefinitions.find((t) => t.confirmedAt !== null);
  const building = head.buildings.find((b) => b.id === task?.productionSetup?.buildingId) ?? head.buildings[0]!;
  return { ...emptyProductionTask(), taskName: task?.name ?? "", buildingName: building.name,
    targets: task?.productionSetup?.targets ?? [], outputUnit: task?.productionSetup?.outputUnit ?? "mm",
    projectGroup: task?.productionSetup?.projectGroup ?? "", buildingType: building.buildingType ?? "", mainStructure: building.mainStructure ?? "" };
}
export function requiredMaterialHint(targets: ProductionSetup["targets"]): string {
  return "平面图或可读草图，尺度与位置依据" + (targets.includes("model") ? "；主体模型还需高度依据" : "")
    + (targets.includes("elevation") ? "；指定立面需要该方向图纸或可校准照片" : "")
    + (targets.includes("section") ? "；指定剖面需要剖切位置与构造记录" : "") + "。";
}
