import { useRef, useState } from "react";
import type { ModelCandidate } from "@gujian/domain";
import type { ProjectHead } from "@gujian/application";
import { dimensionConflict, latestDimensionReview, reviewedDimension, validateDimensionReview, type DimensionReviewDraft } from "../dimension-review";
import { Alert, Button, Field, Tag } from "../ui";
import "./DimensionCandidateReview.css";

type RowDraft = Omit<DimensionReviewDraft, "disposition"> & { disposition: "pending" | "adopt" | "reject" };
export interface DimensionCandidateReviewProps {
  candidate: ModelCandidate;
  snapshot: ProjectHead["snapshot"];
  evidenceTitle: (ref: string) => string;
  onShowEvidence: (ref: string, rowIndex?: number) => void;
  selectedRowIndex?: number | undefined;
  onSubmit: (candidate: ModelCandidate, drafts: DimensionReviewDraft[]) => Promise<boolean>;
}
export function DimensionCandidateReview({ candidate: currentCandidate, snapshot, evidenceTitle, onShowEvidence, onSubmit, selectedRowIndex }: DimensionCandidateReviewProps) {
  const [candidate] = useState(currentCandidate);
  const changed = JSON.stringify(candidate) !== JSON.stringify(currentCandidate);
  const sourceRows = candidate.structured?.kind === "measurementTranscription" ? candidate.structured.dimensions : [];
  const [drafts, setDrafts] = useState<RowDraft[]>(() => sourceRows.map((row, rowIndex) => {
    const previous = selectedRowIndex === rowIndex ? latestDimensionReview(snapshot.facts, candidate.id, rowIndex) : null;
    const saved = previous ? reviewedDimension(previous) : null;
    return { rowIndex, quantityKind: saved?.quantityKind ?? row.quantityKind ?? "length", disposition: selectedRowIndex === rowIndex ? "adopt" : "pending", name: saved?.name ?? row.partZh ?? "", valueMm: saved?.value === null || saved?.value === undefined ? row.valueMm ?? "" : String(saved.value), checked: false, reason: "" };
  }));
  const [editing, setEditing] = useState<number[]>(selectedRowIndex === undefined ? [] : [selectedRowIndex]);
  const [errors, setErrors] = useState<Record<number, string[]>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const locked = changed || candidate.reviewStatus === "rejected" || candidate.reviewStatus === "superseded";
  const patch = (index: number, update: Partial<RowDraft>) => {
    setDrafts((values) => values.map((value, i) => i === index ? { ...value, ...update } : value));
    setErrors((values) => ({ ...values, [index]: [] })); setStatus(null);
  };
  const active = drafts.filter((draft) => draft.disposition !== "pending" && (selectedRowIndex === undefined || draft.rowIndex === selectedRowIndex)) as DimensionReviewDraft[];
  const submit = async () => {
    if (pending.current || locked) return;
    if (!active.length) { setStatus("请逐条选择需要采用或驳回的内容。"); return; }
    const invalid = Object.fromEntries(active.map((draft) => [draft.rowIndex, validateDimensionReview(snapshot, candidate, draft)]).filter(([, issues]) => (issues as string[]).length));
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      setStatus("请修正标出的条目，草稿已保留。");
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    pending.current = true; setSaving(true); setStatus(null);
    try {
      const ok = await onSubmit(candidate, active);
      if (ok) {
        setDrafts((values) => values.map((row) => ({ ...row, disposition: "pending", checked: false })));
        setEditing([]); setStatus("本次处置已保存。采用值仍为资料转写，不代表现场实测。");
      } else setStatus("保存未成功。草稿已保留，可修正后重试。");
    } catch { setStatus("保存未成功。草稿已保留，可修正后重试。"); }
    finally { pending.current = false; setSaving(false); }
  };
  return (
    <form ref={form} className="sc-dimension-review" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate aria-label="尺寸候选核对">
      {selectedRowIndex === undefined && <><strong>{candidate.structured?.summary ?? "尺寸候选"}</strong>
      <p className="gj-pane-desc">核对原资料后逐条选择。模型的确定度仅供参考，未知尺寸需要补充依据。</p></>}
      <fieldset disabled={saving || locked}>
        {drafts.map((draft, index) => {
          if (selectedRowIndex !== undefined && index !== selectedRowIndex) return null;
          const original = sourceRows[index]!;
          const previous = latestDimensionReview(snapshot.facts, candidate.id, index);
          const saved = previous ? reviewedDimension(previous) : null;
          const readonly = saved !== null && !editing.includes(index);
          const rowErrors = errors[index] ?? [];
          const nameError = rowErrors.find((error) => error.includes("尺寸名称"));
          const valueError = rowErrors.find((error) => error.includes("毫米数值"));
          const remainingErrors = rowErrors.filter((error) => error !== nameError && error !== valueError);
          const conflict = dimensionConflict(snapshot, candidate, index, draft.name, draft.valueMm);
          return (
            <article aria-current={selectedRowIndex === index ? "true" : undefined} className="sc-dimension-review-row" id={"dimension-" + candidate.id + "-" + index} key={index}>
              <div className="gj-row"><strong>{index + 1}. {original.partZh || "部位未定"}</strong>
                {!saved && <Tag tone={original.certainty === "uncertain" ? "warning" : "neutral"}>{original.certainty === "uncertain" ? "读数待核实" : "待核对"}</Tag>}
                {saved && <Tag tone={saved.disposition === "adopt" ? "success" : "neutral"}>{!readonly ? "上次" : ""}{saved.disposition === "adopt" ? "已采用" : "已驳回"}</Tag>}
              </div>
              <p className="gj-note">原标注：{original.valueText}；原候选：{original.valueMm?.trim() ? original.valueMm + " mm" : "数值未知"}{original.locationZh ? "；" + original.locationZh : ""}</p>
              <Button compact onClick={() => onShowEvidence(original.evidenceRef, index)} disabled={!snapshot.evidences.some((item) => item.id === original.evidenceRef)}>查看资料：{evidenceTitle(original.evidenceRef)}</Button>
              {original.noteZh && <p className="gj-note">{original.noteZh}</p>}
              {readonly ? <>
                <p className="gj-note">{saved.name} · {saved.quantityKind === "relativeElevation" ? "相对标高" : "长度"} · {saved.value === null ? "未采用" : saved.value + " mm"} · 资料转写{saved.reason ? "；" + saved.reason : ""}</p>
                <Button compact onClick={() => { setEditing((values) => [...values, index]); patch(index, { disposition: "pending", quantityKind: saved.quantityKind ?? "length", name: saved.name, valueMm: saved.value === null ? original.valueMm ?? "" : String(saved.value), reason: "", checked: false }); }}>重新核对第 {index + 1} 条</Button>
              </> : <>
                <Field label={"第 " + (index + 1) + " 条处置"}>
                  <select aria-label={"第 " + (index + 1) + " 条处置"} value={draft.disposition} onChange={(event) => patch(index, { disposition: event.target.value as RowDraft["disposition"], checked: false })}>
                    <option value="pending">暂不处理</option><option value="adopt">采用</option><option value="reject">驳回</option>
                  </select>
                </Field>
                <Field label="标注类型"><select aria-label={"第 " + (index + 1) + " 条标注类型"} value={draft.quantityKind ?? "length"} onChange={(event) => patch(index, { quantityKind: event.target.value as "length" | "relativeElevation", checked: false })}><option value="length">长度</option><option value="relativeElevation">相对标高</option></select></Field>
                {draft.disposition === "adopt" && <>
                  <div className="sc-dimension-review-grid">
                    <Field label="尺寸名称" error={nameError ?? null}><input aria-invalid={nameError ? true : undefined} aria-label={"第 " + (index + 1) + " 条名称"} value={draft.name} maxLength={120} onChange={(event) => patch(index, { name: event.target.value, checked: false })} /></Field>
                    <Field label="采用数值（mm）" error={valueError ?? null}><input aria-invalid={valueError ? true : undefined} aria-label={"第 " + (index + 1) + " 条数值"} inputMode="decimal" value={draft.valueMm} onChange={(event) => patch(index, { valueMm: event.target.value, checked: false })} /></Field>
                  </div>
                  {conflict && <Alert tone="warning">存在同名异值，请核对是否为同一部位并填写说明。系统保留双方资料，不自动合并。</Alert>}
                  <label className="gj-check"><input type="checkbox" checked={draft.checked} onChange={(event) => patch(index, { checked: event.target.checked })} aria-label={"已核对第 " + (index + 1) + " 条原资料"} />已核对原资料及本次采用值</label>
                </>}
                {draft.disposition !== "pending" && <Field label={draft.disposition === "reject" ? "驳回原因" : "核对说明"} error={remainingErrors.join(" ")}>
                  <textarea aria-label={"第 " + (index + 1) + " 条说明"} aria-invalid={remainingErrors.length ? true : undefined} value={draft.reason} maxLength={2000} onChange={(event) => patch(index, { reason: event.target.value })} />
                </Field>}
              </>}
            </article>
          );
        })}
        <p className="gj-note">本次采用 {active.filter((row) => row.disposition === "adopt").length} 条，驳回 {active.filter((row) => row.disposition === "reject").length} 条。其余保持原状态。</p>
        <div className="gj-actions"><Button variant="primary" type="submit" disabled={!active.length}>{saving ? "正在保存…" : "保存所选尺寸处置"}</Button></div>
      </fieldset>
      {locked && <Alert tone="warning">{changed ? "候选内容已变化，原草稿已保留，请重新打开本页核对最新内容。" : "本次候选已整体驳回或被替代，仅供查看。"}</Alert>}
      {status && <div role="status"><Alert tone="neutral">{status}</Alert></div>}
    </form>
  );
}



