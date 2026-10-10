import { useState } from "react";
import type { ProjectHead } from "@gujian/application";
import { COVERAGE_HINTS, COVERAGE_LABELS, coverageEntries, materialCoverage, type CoverageEntry } from "../material-coverage";
import { Button, Field } from "../ui";

export function MaterialCoverage({ snapshot, onSelect }: { snapshot: ProjectHead["snapshot"]; onSelect: (id: string) => void }) {
  const rows = materialCoverage(snapshot);
  return <div className="gj-card gj-card--compact"><strong>所选成果的资料覆盖</strong>
    <p className="gj-pane-desc">对照原件登记支持内容和来源位置。资料可读后仍需登记，具体尺寸和对象继续核对。</p>
    {rows.length ? rows.map((row) => <div key={row.purpose}><p><strong>{row.label}</strong> · {row.sources.length ? "已登记依据" : "待补充依据"}</p>
      {row.sources.map((source) => <p key={source.evidenceId}><Button compact onClick={() => onSelect(source.evidenceId)}>{source.title}</Button> · {source.location}</p>)}</div>) : <p>请在任务设置中明确目标成果。</p>}
  </div>;
}
export function MaterialCoverageEditor({ snapshot, evidenceId, onSave, onOpen }: { snapshot: ProjectHead["snapshot"]; evidenceId: string; onSave: (id: string, entries: CoverageEntry[]) => Promise<boolean>; onOpen?: () => void }) {
  const [editing, setEditing] = useState(false); const [entries, setEntries] = useState(coverageEntries(snapshot, evidenceId));
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const open = () => { onOpen?.(); setEntries(coverageEntries(snapshot, evidenceId)); setError(null); setEditing(true); };
  const save = async () => {
    if (entries.some((entry) => !entry.sourceLocation.trim())) { setError("请填写所选内容的来源位置。"); return; }
    setSaving(true); setError(null);
    try { if (await onSave(evidenceId, entries)) setEditing(false); else setError("保存未完成，请保留输入并重试。"); }
    finally { setSaving(false); }
  };
  if (!editing) return <Button compact onClick={open}>登记资料覆盖</Button>;
  return <form className="gj-pane-list" aria-label="资料覆盖登记" onSubmit={(event) => { event.preventDefault(); if (!saving) void save(); }}>
    <p className="gj-note">本资料支持哪些内容，同一份资料可选择多项。全部取消后保存可清空登记。</p>
    {Object.entries(COVERAGE_LABELS).map(([key, label]) => { const purpose = key as CoverageEntry["purpose"]; const entry = entries.find((item) => item.purpose === purpose);
      return <div className="gj-pane-list" key={key}><label className="gj-check"><input type="checkbox" aria-label={"覆盖 " + label} checked={Boolean(entry)} disabled={saving} onChange={(event) => setEntries(event.target.checked ? [...entries, { purpose, sourceLocation: "" }] : entries.filter((item) => item.purpose !== purpose))} /> {label}</label>
        {entry && <Field label={COVERAGE_HINTS[purpose]}><input aria-label={label + "来源位置"} maxLength={500} value={entry.sourceLocation} disabled={saving} onChange={(event) => setEntries(entries.map((item) => item.purpose === purpose ? { ...item, sourceLocation: event.target.value } : item))} /></Field>}</div>;
    })}
    {error && <p role="alert">{error}</p>}
    <div className="gj-actions"><Button type="submit" variant="primary" disabled={saving}>{saving ? "正在保存覆盖" : "保存资料覆盖"}</Button><Button disabled={saving} onClick={() => setEditing(false)}>取消登记</Button></div>
  </form>;
}
