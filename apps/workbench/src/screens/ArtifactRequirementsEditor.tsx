import { useId, useState } from "react";
import { DRAWING_KIND_LABELS } from "../labels";
import { Button, Field } from "../ui";
import {
  newSheet, newView, type FieldErrors, type ReferenceOption, type RequirementReferences,
  type RequirementsDraft, type SheetDraft, type ViewDraft,
} from "../task-requirements";
import "./ArtifactRequirementsEditor.css";

interface Props {
  value: RequirementsDraft;
  onChange: (value: RequirementsDraft) => void;
  errors: FieldErrors;
  references: RequirementReferences;
  roleOptions: ReferenceOption[];
}
const errorAt = (errors: FieldErrors, path: string) => [...new Set(Object.entries(errors)
  .filter(([key]) => key === path || key.startsWith(path + ".")).map(([, message]) => message))].join(" ") || null;

function TextField({ label, value, onChange, error, numeric = false, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; error?: string | null; numeric?: boolean; maxLength?: number;
}) {
  const id = useId();
  return <Field label={label} error={error ?? null} required>
    <input value={value} type={numeric ? "number" : "text"} step={numeric ? "any" : undefined} maxLength={maxLength}
      aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? id : undefined}
      onChange={(event) => onChange(event.target.value)} />
    {error && <span id={id} hidden>{error}</span>}
  </Field>;
}

function NumberGroup({ label, labels, values, onChange, error }: {
  label: string; labels: string[]; values: string[]; onChange: (index: number, value: string) => void; error?: string | null;
}) {
  return <fieldset className="sc-requirements-group">
    <legend>{label}</legend>
    <div className="sc-requirements-grid">
      {values.map((value, index) => <TextField key={index} label={label + " · " + labels[index]} value={value} numeric
        onChange={(next) => onChange(index, next)} error={error ?? null} />)}
    </div>
  </fieldset>;
}

function ReferencePicker({ label, options, values, onChange, error }: {
  label: string; options: ReferenceOption[]; values: string[]; onChange: (value: string[]) => void; error?: string | null;
}) {
  const [query, setQuery] = useState("");
  const matches = options.filter((item) => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && !values.includes(item.value));
  return <fieldset className="sc-requirements-group">
    <legend>{label}（已选 {values.length} 项）</legend>
    {error && <p className="gj-field-error" role="alert">{error}</p>}
    {values.length > 0 && <ul className="sc-requirements-selected">
      {values.map((value, index) => <li key={value}>
        <span>{options.find((item) => item.value === value)?.label ?? "当前项目中缺失的引用 " + (index + 1)}</span>
        <Button compact onClick={() => onChange(values.filter((item) => item !== value))}>移除</Button>
      </li>)}
    </ul>}
    <Field label={"查找" + label}><input value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
    <Field label={"添加" + label}>
      <select value="" aria-invalid={Boolean(error)} onChange={(event) => { if (event.target.value) onChange([...values, event.target.value]); }}>
        <option value="">请选择</option>
        {matches.slice(0, 50).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
    <p className="gj-note">{options.length ? (matches.length > 50 ? "显示前 50 项，请按名称缩小查找范围。" : "选项来自当前项目。") : "当前项目暂无可选记录。已有引用保留，请核对后处理。"}</p>
  </fieldset>;
}

const DIRECTIONS: { label: string; direction: ViewDraft["direction"]; right: ViewDraft["right"]; up: ViewDraft["up"] }[] = [
  { label: "沿 Z 轴向下看", direction: ["0", "0", "1"], right: ["1", "0", "0"], up: ["0", "1", "0"] },
  { label: "从 Y 轴负向看", direction: ["0", "-1", "0"], right: ["1", "0", "0"], up: ["0", "0", "1"] },
  { label: "从 Y 轴正向看", direction: ["0", "1", "0"], right: ["-1", "0", "0"], up: ["0", "0", "1"] },
  { label: "从 X 轴负向看", direction: ["-1", "0", "0"], right: ["0", "-1", "0"], up: ["0", "0", "1"] },
  { label: "从 X 轴正向看", direction: ["1", "0", "0"], right: ["0", "1", "0"], up: ["0", "0", "1"] },
];
const PAGES = [
  { label: "A4 横向", page: ["297", "210"] }, { label: "A3 横向", page: ["420", "297"] },
  { label: "A2 横向", page: ["594", "420"] }, { label: "A1 横向", page: ["841", "594"] },
  { label: "A0 横向", page: ["1189", "841"] },
];

export function ArtifactRequirementsEditor({ value, onChange, errors, references, roleOptions }: Props) {
  const knownRoles = [{ value: "wall", label: "墙" }, { value: "column", label: "柱" }, { value: "roof", label: "屋顶" }, ...roleOptions];
  const roleLabel = (role: string) => knownRoles.find((option) => option.value === role)?.label ?? role;
  const sheetChange = (index: number, patch: Partial<SheetDraft>) => onChange({ ...value, sheets: value.sheets.map((sheet, i) => i === index ? { ...sheet, ...patch } : sheet) });
  const viewChange = (index: number, patch: Partial<ViewDraft>) => onChange({ ...value, views: value.views.map((view, i) => i === index ? { ...view, ...patch } : view) });
  return <div className="sc-requirements">
    <div className="sc-requirements-grid">
      <TextField label="图纸标题" value={value.titleZh} maxLength={120} error={errorAt(errors, "titleZh")} onChange={(titleZh) => onChange({ ...value, titleZh })} />
      <TextField label="修订标记" value={value.revisionLabel} maxLength={16} error={errorAt(errors, "revisionLabel")} onChange={(revisionLabel) => onChange({ ...value, revisionLabel })} />
    </div>
    <Field label="需要出图的构件类型（每行一项）" required error={errorAt(errors, "geometryTargetRoles")}>
      <textarea value={value.geometryTargetRoles.map(roleLabel).join("\n")} aria-invalid={Boolean(errorAt(errors, "geometryTargetRoles"))}
        onChange={(event) => onChange({ ...value, geometryTargetRoles: event.target.value.split("\n").map((label) => value.geometryTargetRoles.find((role) => roleLabel(role) === label) ?? knownRoles.find((option) => option.label === label)?.value ?? label) })} placeholder="填写本次任务需要的构件类型" />
    </Field>
    {roleOptions.length > 0 && <Field label="从当前项目添加构件类型"><select value="" onChange={(event) => {
      if (event.target.value && !value.geometryTargetRoles.includes(event.target.value)) onChange({ ...value, geometryTargetRoles: [...value.geometryTargetRoles.filter(Boolean), event.target.value] });
    }}><option value="">请选择</option>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>}
    <div className="sc-requirements-heading"><h4>图幅（{value.sheets.length}）</h4><Button compact disabled={value.sheets.length >= 50} onClick={() => onChange({ ...value, sheets: [...value.sheets, newSheet()] })}>新增图幅</Button></div>
    {value.sheets.map((sheet, index) => {
      const path = "sheets." + index;
      const linked = value.views.filter((view) => view.sheetKey === sheet.key);
      const pageIndex = PAGES.findIndex((page) => page.page.every((n, i) => Number(n) === Number(sheet.pageMm[i])));
      return <details className="sc-requirements-card" key={sheet.key} open>
        <summary>{"图幅 " + (index + 1) + "：" + (sheet.displayLabelZh || "尚未命名")}{errorAt(errors, path) && <span className="gj-field-error"> 请检查</span>}</summary>
        <div className="sc-requirements-body">
          <div className="sc-requirements-grid">
            <TextField label="图号" value={sheet.drawingNumber} maxLength={32} error={errorAt(errors, path + ".drawingNumber")} onChange={(drawingNumber) => sheetChange(index, { drawingNumber })} />
            <TextField label="图幅名称" value={sheet.displayLabelZh} maxLength={80} error={errorAt(errors, path + ".displayLabelZh")} onChange={(displayLabelZh) => sheetChange(index, { displayLabelZh })} />
          </div>
          <p className="gj-note">当前制图器支持 A3、A2、A1 横向。其他尺寸可作为任务要求保存，生成前需调整为支持的图幅。视口应留出左右各 10 mm、下侧 20 mm、上侧 35 mm，且不与同图幅其他视图重叠。右下图签上方的视口 Y 至少为 38 mm，默认使用 40 mm。</p>
          <Field label="标准图幅"><select value={pageIndex < 0 ? "custom" : String(pageIndex)} onChange={(event) => {
            const page = PAGES[Number(event.target.value)];
            if (page) sheetChange(index, { pageMm: [page.page[0]!, page.page[1]!] });
          }}><option value="custom">自定义（在下方填写宽高）</option>{PAGES.map((page, i) => <option key={page.label} value={String(i)}>{page.label}</option>)}</select></Field>
          <NumberGroup label="图幅尺寸（mm）" labels={["宽", "高"]} values={sheet.pageMm} error={errorAt(errors, path + ".pageMm")}
            onChange={(at, next) => { const pageMm: SheetDraft["pageMm"] = [...sheet.pageMm]; pageMm[at] = next; sheetChange(index, { pageMm }); }} />
          <div className="gj-actions"><Button compact variant="danger" disabled={Boolean(linked.length) || value.sheets.length === 1}
            onClick={() => onChange({ ...value, sheets: value.sheets.filter((s) => s.key !== sheet.key) })}>移除图幅</Button></div>
          {linked.length > 0 && <p className="gj-note">移除前，请将本图幅的 {linked.length} 个视图移至其他图幅，或移除这些视图。</p>}
        </div>
      </details>;
    })}
    <div className="sc-requirements-heading"><h4>视图（{value.views.length}）</h4><Button compact disabled={value.views.length >= 100} onClick={() => onChange({ ...value, views: [...value.views, newView(value.sheets[0])] })}>新增视图</Button></div>
    {value.views.map((view, index) => {
      const path = "views." + index;
      const orientation = DIRECTIONS.findIndex((preset) => (["direction", "right", "up"] as const).every((axis) => preset[axis].every((n, i) => Number(n) === Number(view[axis][i]))));
      return <details className="sc-requirements-card" key={view.key} open>
        <summary>{"视图 " + (index + 1) + "：" + (view.displayLabelZh || "尚未命名")}{errorAt(errors, path) && <span className="gj-field-error"> 请检查</span>}</summary>
        <div className="sc-requirements-body">
          <div className="sc-requirements-grid">
            <TextField label="视图名称" value={view.displayLabelZh} maxLength={80} error={errorAt(errors, path + ".displayLabelZh")} onChange={(displayLabelZh) => viewChange(index, { displayLabelZh })} />
            <TextField label="视图编号" value={view.drawingRef} maxLength={20} error={errorAt(errors, path + ".drawingRef")} onChange={(drawingRef) => viewChange(index, { drawingRef })} />
            <Field label="图种"><select value={view.kind} onChange={(event) => viewChange(index, { kind: event.target.value as ViewDraft["kind"] })}>
              {Object.entries(DRAWING_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select></Field>
            <TextField label="比例分母（1 : N）" value={view.scaleDenominator} numeric error={errorAt(errors, path + ".scaleDenominator")} onChange={(scaleDenominator) => viewChange(index, { scaleDenominator })} />
          </div>
          <Field label="所属图幅" error={errorAt(errors, path + ".sheetKey")}><select aria-label="所属图幅" aria-invalid={Boolean(errorAt(errors, path + ".sheetKey"))} value={view.sheetKey} onChange={(event) => viewChange(index, { sheetKey: event.target.value })}>
            {!value.sheets.some((sheet) => sheet.key === view.sheetKey) && <option value={view.sheetKey}>请选择现有图幅</option>}
            {value.sheets.map((sheet, i) => <option key={sheet.key} value={sheet.key}>{sheet.displayLabelZh || "图幅 " + (i + 1)}{sheet.drawingNumber ? "（" + sheet.drawingNumber + "）" : ""}</option>)}
          </select></Field>
          <NumberGroup label="视口（图纸 mm）" labels={["左下 X", "左下 Y", "宽", "高"]} values={view.viewportRectMm} error={errorAt(errors, path + ".viewportRectMm")}
            onChange={(at, next) => { const viewportRectMm: ViewDraft["viewportRectMm"] = [...view.viewportRectMm]; viewportRectMm[at] = next; viewChange(index, { viewportRectMm }); }} />
          <Field label="观察方向" error={errorAt(errors, path + ".orientation")}><select aria-label="观察方向" aria-invalid={Boolean(errorAt(errors, path + ".orientation"))} value={orientation < 0 ? "custom" : String(orientation)} onChange={(event) => {
            const preset = DIRECTIONS[Number(event.target.value)];
            if (preset) viewChange(index, { direction: [...preset.direction], right: [...preset.right], up: [...preset.up] });
          }}><option value="custom">自定义（保留当前方向数值）</option>{DIRECTIONS.map((preset, i) => <option key={preset.label} value={String(i)}>{preset.label}</option>)}</select></Field>
          <details className="sc-requirements-advanced"><summary>方向数值、剖切与局部范围{errorAt(errors, path + ".sectionPlane") || errorAt(errors, path + ".cropBoundsMm") ? " · 请检查" : ""}</summary>
            <div className="sc-requirements-body">
              <p className="gj-note">项目坐标以 Z 轴向上，尺寸为 mm。朝向修改不改变已有剖切法向，请分别核对。</p>
              {(["direction", "right", "up"] as const).map((axis, at) => <NumberGroup key={axis} label={["观察方向", "图面向右", "图面向上"][at]!} labels={["X", "Y", "Z"]} values={view[axis]}
                error={errorAt(errors, path + "." + axis) ?? errorAt(errors, path + ".orientation")}
                onChange={(position, next) => { const vector: ViewDraft["direction"] = [...view[axis]]; vector[position] = next; viewChange(index, { [axis]: vector }); }} />)}
              <Field label="指定剖切平面" error={errorAt(errors, path + ".sectionPlane")}><input type="checkbox" aria-label="指定剖切平面" aria-invalid={Boolean(errorAt(errors, path + ".sectionPlane"))} checked={Boolean(view.sectionPlane)} onChange={(event) => {
                if (event.target.checked) viewChange(index, { sectionPlane: { normal: [...view.direction], offsetMm: "" } });
                else { const { sectionPlane: _removed, ...rest } = view; onChange({ ...value, views: value.views.map((v, i) => i === index ? rest : v) }); }
              }} /></Field>
              {view.sectionPlane && <>
                <TextField label="剖切偏移（mm）" value={view.sectionPlane.offsetMm} numeric error={errorAt(errors, path + ".sectionPlane")} onChange={(offsetMm) => viewChange(index, { sectionPlane: { ...view.sectionPlane!, offsetMm } })} />
                <NumberGroup label="剖切法向" labels={["X", "Y", "Z"]} values={view.sectionPlane.normal} error={errorAt(errors, path + ".sectionPlane")}
                  onChange={(at, next) => { const normal: ViewDraft["direction"] = [...view.sectionPlane!.normal]; normal[at] = next; viewChange(index, { sectionPlane: { ...view.sectionPlane!, normal } }); }} />
              </>}
              <Field label="指定裁切范围" error={errorAt(errors, path + ".cropBoundsMm")}><input type="checkbox" aria-label="指定裁切范围" aria-invalid={Boolean(errorAt(errors, path + ".cropBoundsMm"))} checked={Boolean(view.cropBoundsMm)} onChange={(event) => {
                if (event.target.checked) viewChange(index, { cropBoundsMm: ["", "", "", ""] });
                else { const { cropBoundsMm: _removed, ...rest } = view; onChange({ ...value, views: value.views.map((v, i) => i === index ? rest : v) }); }
              }} /></Field>
              {view.cropBoundsMm && <NumberGroup label="裁切范围（视图坐标 mm）" labels={["向右最小值", "向上最小值", "向右最大值", "向上最大值"]} values={view.cropBoundsMm} error={errorAt(errors, path + ".cropBoundsMm")}
                onChange={(at, next) => { const cropBoundsMm: NonNullable<ViewDraft["cropBoundsMm"]> = [...view.cropBoundsMm!]; cropBoundsMm[at] = next; viewChange(index, { cropBoundsMm }); }} />}
              <ReferencePicker label="目标构件" values={view.targetStableKeys} options={references.components} error={errorAt(errors, path + ".targetStableKeys")} onChange={(targetStableKeys) => viewChange(index, { targetStableKeys })} />
              <ReferencePicker label="依据资料" values={view.sourceEvidenceRefs} options={references.evidences} error={errorAt(errors, path + ".sourceEvidenceRefs")} onChange={(sourceEvidenceRefs) => viewChange(index, { sourceEvidenceRefs })} />
            </div>
          </details>
          <div className="gj-actions"><Button compact variant="danger" disabled={value.views.length === 1} onClick={() => onChange({ ...value, views: value.views.filter((v) => v.key !== view.key) })}>移除视图</Button></div>
        </div>
      </details>;
    })}
  </div>;
}



