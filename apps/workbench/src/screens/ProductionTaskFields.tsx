import { Field } from "../ui";
import { TARGET_LABELS, type ProductionTaskValues } from "../production-task";
export function ProductionTaskFields({ value, onChange, errors = {} }: { value: ProductionTaskValues; onChange: (value: ProductionTaskValues) => void; errors?: Record<string, string> }) {
  const field = (key: "taskName" | "buildingName" | "projectGroup" | "buildingType" | "mainStructure", label: string, required = false) =>
    <Field label={label} required={required} error={errors[key] ?? null}><input aria-label={label} value={value[key]} maxLength={200} aria-invalid={Boolean(errors[key])} onChange={(e) => onChange({ ...value, [key]: e.target.value })} /></Field>;
  return <>
    {field("taskName", "任务名称", true)}{field("buildingName", "建筑名称", true)}
    <div className="sc-production-row">
      <Field label="制作目的" required><select aria-label="制作目的" value={value.purpose} onChange={() => onChange({ ...value, purpose: "existingSurvey" })}><option value="existingSurvey">现状测绘</option></select></Field>
      <Field label="输出单位" required><select aria-label="输出单位" value={value.outputUnit} onChange={(e) => onChange({ ...value, outputUnit: e.target.value as ProductionTaskValues["outputUnit"] })}><option value="mm">毫米</option><option value="cm">厘米</option><option value="m">米</option></select></Field>
    </div>
    <fieldset className="sc-production-targets" aria-label="目标成果"><legend>目标成果</legend>
      {(Object.keys(TARGET_LABELS) as (keyof typeof TARGET_LABELS)[]).map((target) => <label key={target}><input type="checkbox" checked={value.targets.includes(target)} onChange={(e) => onChange({ ...value, targets: e.target.checked ? [...value.targets, target] : value.targets.filter((t) => t !== target) })} />{TARGET_LABELS[target]}</label>)}
      {errors.targets && <p className="gj-field-error" role="alert">{errors.targets}</p>}
    </fieldset>
    <details className="sc-production-extra"><summary>建筑补充信息（选填）</summary>
      {field("projectGroup", "所属项目或村落")}{field("buildingType", "建筑类型")}{field("mainStructure", "主要结构")}
    </details>
  </>;
}
