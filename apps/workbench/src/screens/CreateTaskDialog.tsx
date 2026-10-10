import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "../ui";
import { emptyProductionTask, productionErrors, LEVEL_LABELS, requiredMaterialHint, type PreparedFile, type PreparationLevel } from "../production-task";
import type { CreateProjectValues } from "../workbench/useProjectSession";
import { ProductionTaskFields } from "./ProductionTaskFields";
import "./CreateTaskDialog.css";
export type CreateDestination = "tasks" | "evidence" | "list";
export function CreateTaskDialog({ onSubmit, onClose }: { onSubmit: (values: CreateProjectValues, files: readonly PreparedFile[], destination: CreateDestination) => Promise<boolean>; onClose: () => void }) {
  const [value, setValue] = useState(emptyProductionTask);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pending = useRef(false);
  const fileInputs = useRef<Partial<Record<PreparationLevel, HTMLInputElement | null>>>({});
  const form = useRef<HTMLFormElement>(null);
  const initial = useRef(JSON.stringify(emptyProductionTask()));
  const dirty = JSON.stringify(value) !== initial.current || files.length > 0;
  const leave = () => { if (saving) return; if (dirty) setLeaving(true); else onClose(); };
  useEffect(() => { form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  const save = async (destination: CreateDestination) => {
    if (pending.current) return;
    const next = productionErrors(value); setErrors(next);
    if (Object.keys(next).length) { requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    pending.current = true; setSaving(true); setFailure(false);
    try {
      const ok = await onSubmit({ name: value.projectGroup.trim() || value.taskName.trim(), buildingName: value.buildingName.trim(), locationText: "", production: value }, files, destination);
      if (!ok) setFailure(true);
    } catch { setFailure(true); }
    finally { pending.current = false; setSaving(false); }
  };
  return <div className="gj-scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) leave(); }}>
    <form ref={form} className="sc-create" role="dialog" aria-modal="true" aria-labelledby="sc-create-title" noValidate onSubmit={(e) => { e.preventDefault(); void save("evidence"); }} onKeyDown={(e) => {
      if (e.key === "Escape") {
        const select = e.target instanceof Element ? e.target.closest("select") : null;
        if (select?.matches(":open")) return;
        e.preventDefault(); leave();
      }
      if (e.key === "Tab") { const nodes = form.current?.querySelectorAll<HTMLElement>('input:not([disabled]),select:not([disabled]),button:not([disabled]),summary');
        const visible = [...(nodes ?? [])].filter((n) => n.getClientRects().length > 0); const first = visible[0]; const last = visible.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="sc-create-heading">
        <h2 className="sc-create-title" id="sc-create-title">创建制作任务</h2>
        <p className="sc-create-note">填写本次建筑与目标成果，再准备已有资料。图纸比例、图幅和剖切设置在生成前补充。</p>
      </div>
      <div className="sc-create-content">
        <fieldset disabled={saving} className="sc-create-columns">
        <section className="sc-production-fields"><h3 className="gj-text-section">本次任务</h3><ProductionTaskFields value={value} onChange={(next) => { setValue(next); if (Object.keys(errors).length) setErrors(productionErrors(next)); }} errors={errors} /></section>
        <section className="sc-create-materials"><h3 className="gj-text-section">原始资料</h3><p className="gj-note">资料要求随目标更新；一份文件可支持多项要求。首次预览只需一份可读建筑资料。</p>
          {(Object.keys(LEVEL_LABELS) as PreparationLevel[]).map((level) => <section key={level} className="sc-create-level" aria-label={LEVEL_LABELS[level] + "资料"}>
            <h4>{LEVEL_LABELS[level]}</h4><p className="gj-note">{level === "required" ? requiredMaterialHint(value.targets) : level === "recommended" ? "其他方向照片、历史图纸与说明，用于核对关系和来源。" : "详图、节点照片和局部尺寸，用于增加细节。"}</p>
            {files.filter((entry) => entry.level === level).map((entry) => <div key={files.indexOf(entry)} className="sc-create-file"><span>{entry.file.name}<small>待保存</small></span><Button compact aria-label={"移除：" + entry.file.name} onClick={() => setFiles(files.filter((item) => item !== entry))}>移除</Button></div>)}
            <div className="sc-create-upload"><Button onClick={() => fileInputs.current[level]?.click()}>添加{LEVEL_LABELS[level]}资料</Button><input hidden ref={(element) => { fileInputs.current[level] = element; }} type="file" multiple aria-label={"添加" + LEVEL_LABELS[level] + "资料"} onChange={(e) => { const added = Array.from(e.target.files ?? []).map((file) => ({ file, level })); setFiles((existing) => [...existing, ...added]); e.target.value = ""; }} /></div>
          </section>)}
        </section>
        </fieldset>
      </div>
      <div className="sc-create-footer">
        {failure && <Alert tone="danger" role="alert">任务保存未成功。填写内容和所选文件已保留，请重试。</Alert>}
        {leaving ? <Alert tone="info"><p>本页有未保存内容。</p><div className="gj-actions"><Button onClick={() => void save("list")} disabled={saving}>保存后返回</Button><Button onClick={() => setLeaving(false)} disabled={saving}>继续编辑</Button></div></Alert> :
          <div className="gj-dialog-actions"><Button onClick={leave} disabled={saving}>取消</Button><Button onClick={() => void save("tasks")} disabled={saving}>保存草稿</Button><Button variant="primary" type="submit" busy={saving} disabled={saving}>{saving ? "正在保存任务与资料" : "保存任务并准备资料"}</Button></div>}
      </div>
    </form>
  </div>;
}
