import { useEffect, useRef, useState } from "react";
import type { ProjectHead } from "@gujian/application";
import { EvidenceGeometryComponentValueSchema, GEOMETRY_LENGTH_LABELS } from "@gujian/infrastructure";
import { adoptedDimensions } from "../dimension-review";
import { candidateDimensions, draftGeometryPreview } from "../draft-geometry";
import { DraftGeometryViewer } from "../DraftGeometryViewer";
import { bindingDimension, buildComponentInput, candidateComponent, candidateComponentDraft, candidateComponentInput, componentDraft, componentEntries, componentInputs, COMPONENT_TYPES, LENGTH_FIELDS, type ComponentCandidateSelection, type ComponentDraft, type ComponentInput } from "../component-input";
import { Button, Field, Tag } from "../ui";
import "./GeometryComponentEditor.css";

type Snapshot = ProjectHead["snapshot"];
type SourceRegion = { x: number; y: number; width: number; height: number };
interface Props {
  snapshot: Snapshot; base?: ComponentInput | undefined; initialDraft?: ComponentDraft | undefined;
  onSave: (value: ComponentInput) => Promise<boolean>; onCancel: () => void;
  onSaveDraft?: ((draft: ComponentDraft, base?: ComponentInput) => Promise<boolean>) | undefined;
  onShowEvidence: (ref: string, region?: SourceRegion | null) => void;
  onSelectCandidate?: ((selection: ComponentCandidateSelection) => void) | undefined;
}
export function GeometryComponentEditor({ snapshot, base, initialDraft, onSave, onSaveDraft, onCancel, onShowEvidence, onSelectCandidate }: Props) {
  const [original] = useState(() => base ? EvidenceGeometryComponentValueSchema.parse(base) : undefined);
  const [draft, setDraft] = useState(() => initialDraft ?? componentDraft(base));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ result: ReturnType<typeof draftGeometryPreview>; sourceKey: string } | null>(null);
  const [previewStatus, setPreviewStatus] = useState("");
  const sourcesPanel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const inputs = componentInputs(snapshot);
  const changed = original && JSON.stringify(inputs.find((item) => item.stableKey === original.stableKey)) !== JSON.stringify(original);
  const dimensions = adoptedDimensions(snapshot);
  const candidates = candidateDimensions(snapshot);
  const sourceKey = JSON.stringify({ projectId: snapshot.project.id, facts: snapshot.facts, candidates: snapshot.candidates, evidences: snapshot.evidences, parseRecords: snapshot.parseRecords });
  const currentPreview = preview?.sourceKey === sourceKey && !changed ? preview.result : null;
  const showParameterEvidence = (ref: string, region?: SourceRegion | null) => region ? onShowEvidence(ref, region) : onShowEvidence(ref);
  const hasCandidates = LENGTH_FIELDS[draft.kind].some((field) => Boolean(draft.candidateBindings?.[field]));
  const patch = (values: Partial<ComponentDraft>) => {
    setDraft((current) => ({ ...current, ...values })); setErrors({}); setStatus("");
    if (preview) { setPreview(null); setPreviewStatus("参数已修改，旧形体已清除，请重新预览。"); }
  };
  const showErrors = (next: Record<string, string>, message: string) => {
    setErrors(next); setStatus(message);
    requestAnimationFrame(() => {
      form.current?.querySelectorAll("details").forEach((detail) => { if (detail.querySelector('[aria-invalid="true"]')) detail.open = true; });
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  };
  const showPreview = () => {
    const result = draftGeometryPreview(snapshot, draft, original);
    if (!result.component || changed) { setPreview(null); showErrors(result.errors, "请补齐标出的参数和依据，草稿已保留，原件仍可查看。"); return; }
    setErrors({}); setStatus(""); setPreviewStatus(""); setPreview({ result, sourceKey });
    requestAnimationFrame(() => sourcesPanel.current?.parentElement?.scrollIntoView({ block: "start" }));
  };
  const submit = async () => {
    if (pending.current || changed) return;
    const parsed = hasCandidates ? draftGeometryPreview(snapshot, draft, original) : null;
    const result = parsed ? { value: parsed.component, errors: parsed.errors } : buildComponentInput(snapshot, draft, original);
    setErrors(result.errors);
    if (!result.value) {
      showErrors(result.errors, "请修正标出的输入，草稿已保留。");
      return;
    }
    if (hasCandidates && !onSaveDraft) { setStatus("候选尺寸核对保存暂不可用。草稿和原件已保留。"); return; }
    pending.current = true; setSaving(true); setStatus("");
    try {
      if (await (hasCandidates ? onSaveDraft!(draft, original) : onSave(result.value))) onCancel();
      else setStatus("保存未成功，草稿已保留，可修正后重试。");
    } catch { setStatus("保存未成功，草稿已保留，可修正后重试。"); }
    finally { pending.current = false; setSaving(false); }
  };
  const textField = (key: "name" | "material" | "sourceLocation", label: string, max: number) => (
    <Field label={label} required={key !== "material"} error={errors[key] ?? null}>
      <input aria-label={label} aria-invalid={Boolean(errors[key])} maxLength={max} value={draft[key]} onChange={(event) => patch({ [key]: event.target.value })} />
    </Field>
  );
  const types = new Map<string, string>(COMPONENT_TYPES);
  for (const role of snapshot.taskDefinitions.find((task) => task.confirmedAt !== null)?.artifactRequirements?.geometryTargetRoles ?? []) if (!types.has(role)) types.set(role, role);
  if (draft.componentType && !types.has(draft.componentType)) types.set(draft.componentType, draft.componentType);
  return (
    <form className="sc-component-editor" ref={form} aria-label="构件参数" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <strong>{original ? "编辑构件输入" : "新增构件输入"}</strong>
      {draft.candidateSource && <p className="gj-note">已沿用识别构件的名称、原件和图上位置。只补资料支持的参数，图上区域不作为三维坐标。</p>}
      <p className="gj-note">按资料填写参数，长度可引用已采用尺寸或待核对候选，位置以毫米表示。材料未提供时记录未知。</p>
      {changed && <p role="alert" className="gj-alert gj-alert--warning">当前构件记录已变化。草稿已保留，请取消后重新打开，核对最新输入。</p>}
      <fieldset disabled={saving || Boolean(changed)}>
        <div className="sc-component-grid">
          {textField("name", "构件名称", 200)}
          <Field label="构件类型" required error={errors.componentType ?? null}>
            <select aria-label="构件类型" aria-invalid={Boolean(errors.componentType)} value={draft.componentType} onChange={(event) => patch({ componentType: event.target.value })}>
              <option value="">请选择类型</option>{[...types].map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </Field>
          {textField("material", "材料", 120)}
          <Field label="所属构件" error={errors.parent ?? null}>
            <select aria-label="所属构件" aria-invalid={Boolean(errors.parent)} value={draft.parentStableKey} onChange={(event) => patch({ parentStableKey: event.target.value })}>
              <option value="">无所属构件</option>
              {draft.parentStableKey && !inputs.some((item) => item.stableKey === draft.parentStableKey) && <option value={draft.parentStableKey}>原所属构件已不存在</option>}
              {inputs.filter((item) => item.stableKey !== draft.stableKey).map((item) => <option key={item.stableKey} value={item.stableKey}>{item.displayNameZh}</option>)}
            </select>
          </Field>
          <Field label="实体形式">
            <select aria-label="实体形式" value={draft.kind} onChange={(event) => patch({ kind: event.target.value as ComponentDraft["kind"] })}>
              <option value="box">长方体</option><option value="cylinder">圆柱体</option><option value="extrudedProfile">轮廓挤出</option>
            </select>
          </Field>
          {draft.kind !== "box" && <Field label="轴向"><select aria-label="轴向" value={draft.axis} onChange={(event) => patch({ axis: event.target.value as ComponentDraft["axis"] })}>
            <option value="x">X 轴</option><option value="y">Y 轴</option><option value="z">Z 轴</option>
          </select></Field>}
        </div>
        <p className="gj-note">复杂曲面及其他实体形式暂不支持。长方体按项目坐标轴布置，轮廓按生成器的局部二维坐标填写，不推断缺少的尺寸。</p>
        {LENGTH_FIELDS[draft.kind].map((field) => {
          const ref = draft.bindings[field] ?? "";
          const dimension = ref ? bindingDimension(snapshot, ref) : null;
          const candidateRef = draft.candidateBindings?.[field];
          const candidate = candidateRef ? candidates.find((item) => item.selection.candidateId === candidateRef.candidateId && item.selection.rowIndex === candidateRef.rowIndex) : undefined;
          const selectionKey = candidateRef ? `candidate:${candidateRef.candidateId}:${candidateRef.rowIndex}` : ref;
          return <div className="sc-component-length" key={field}>
            <Field label={GEOMETRY_LENGTH_LABELS[field] + "来源"}>
              <select aria-label={GEOMETRY_LENGTH_LABELS[field] + "来源"} value={selectionKey} onChange={(event) => {
                const next = candidates.find((item) => `candidate:${item.selection.candidateId}:${item.selection.rowIndex}` === event.target.value);
                const bindings = { ...draft.bindings }, candidateBindings = { ...draft.candidateBindings };
                delete bindings[field]; delete candidateBindings[field];
                if (next) candidateBindings[field] = next.selection;
                else if (event.target.value) bindings[field] = event.target.value;
                const adopted = dimensions.find((item) => item.factRef === event.target.value);
                patch({ bindings, candidateBindings, ...(next || adopted ? { lengths: { ...draft.lengths, [field]: String(next?.valueMm ?? adopted!.valueMm) } } : {}) });
              }}>
                <option value="">直接填写</option>
                {ref && !dimensions.some((item) => item.factRef === ref) && <option value={ref}>{dimension ? dimension.name + "（读取最新采用值）" : "原引用已失效，需重新选择"}</option>}
                {dimensions.map((item) => <option key={item.factRef} value={item.factRef}>{item.name + " · " + item.valueMm + " mm"}</option>)}
                {candidateRef && !candidate && <option value={selectionKey}>原候选已失效，请重新选择</option>}
                {candidates.map((item) => <option key={`candidate:${item.selection.candidateId}:${item.selection.rowIndex}`} value={`candidate:${item.selection.candidateId}:${item.selection.rowIndex}`}>{item.name + " · " + item.valueMm + " mm · 待核对" + (item.quantityKind === "unspecified" ? " · 类型待核对" : "")}</option>)}
              </select>
            </Field>
            <Field label={GEOMETRY_LENGTH_LABELS[field] + "（mm）"} required error={errors[field] ?? null}>
              <input aria-label={GEOMETRY_LENGTH_LABELS[field] + "（mm）"} aria-invalid={Boolean(errors[field])} inputMode="decimal" readOnly={Boolean(ref)}
                value={ref ? dimension?.valueMm.toString() ?? "" : draft.lengths[field]} onChange={(event) => patch({ lengths: { ...draft.lengths, [field]: event.target.value } })} />
            </Field>
            {dimension && <div className="sc-component-bound-source">
              <Tag>资料转写 · 读取最新采用值</Tag>
              {dimension.evidenceRefs.map((evidenceRef) => <Button compact key={evidenceRef} onClick={() => onShowEvidence(evidenceRef)}>查看：{snapshot.evidences.find((item) => item.id === evidenceRef)?.title ?? "原资料"}</Button>)}
            </div>}
            {candidate && <div className="sc-component-bound-source">
              <Tag>待核对候选{candidate.quantityKind === "unspecified" ? " · 类型待核对" : ""}</Tag>
              <span>原标注：{candidate.originalText}；位置：{candidate.locationText || "未提供"}。本次用于{GEOMETRY_LENGTH_LABELS[field]}。</span>
              <Button compact onClick={() => showParameterEvidence(candidate.evidenceId, candidate.region)}>查看候选原件：{snapshot.evidences.find((item) => item.id === candidate.evidenceId)?.title ?? "原资料"}</Button>
            </div>}
          </div>;
        })}
        {hasCandidates && <Field label="候选尺寸核对说明" error={errors.candidateReason ?? null}><textarea aria-label="候选尺寸核对说明" aria-invalid={Boolean(errors.candidateReason)} maxLength={2000} value={draft.candidateReason ?? ""} onChange={(event) => patch({ candidateReason: event.target.value })} /><p className="gj-note">修正、待核实或冲突尺寸须说明核对依据；选择类型待核对候选即明确用于当前长度字段。保存会同时采用所选尺寸和构件输入。</p></Field>}
        <strong>{draft.kind === "extrudedProfile" ? "挤出原点" : "实体中心"}（mm）</strong>
        <div className="sc-component-grid sc-component-grid--coordinates">
          {draft.coordinates.map((value, index) => <Field key={index} label={["X", "Y", "Z"][index] + " 坐标"} required error={errors["coordinate" + index] ?? null}>
            <input aria-label={["X", "Y", "Z"][index] + " 坐标"} aria-invalid={Boolean(errors["coordinate" + index])} inputMode="decimal" value={value}
              onChange={(event) => patch({ coordinates: draft.coordinates.map((item, i) => i === index ? event.target.value : item) as ComponentDraft["coordinates"] })} />
          </Field>)}
        </div>
        <Field label="位置依据" error={errors.positionBasis ?? null}><select aria-label="位置依据" aria-invalid={Boolean(errors.positionBasis)} value={draft.positionBasis} onChange={(event) => patch({ positionBasis: event.target.value as ComponentDraft["positionBasis"] })}>
          <option value="human">按资料人工定位</option><option value="measured">现场实测坐标</option><option value="rule">规则推定位置</option><option value="demo">演示位置</option>
        </select></Field>
        <p className="gj-note">选择现场实测坐标时，引用资料应包含相应测量记录。人工确认和资料转写不能改变原有数据来源。</p>
        {draft.kind === "extrudedProfile" && <div className="sc-component-profile" tabIndex={-1} aria-invalid={Boolean(errors.profile)}>
          <strong>轮廓点（mm）</strong><p className="gj-note">按轮廓顺序逐点填写，末点自动连接首点。轴向为 X、Y、Z 时，局部 U/V 分别对应 Y/Z、X/Z、X/Y；挤出方向分别为正 X、负 Y、正 Z。</p>
          {draft.profile.map((point, index) => <div className="sc-component-grid" key={index}>
            {point.map((value, axis) => <Field key={axis} label={"点 " + (index + 1) + " · " + (axis === 0 ? "U" : "V")} error={errors["point" + index + "-" + axis] ?? null}>
              <input aria-label={"点 " + (index + 1) + " " + (axis === 0 ? "U" : "V")} aria-invalid={Boolean(errors["point" + index + "-" + axis])} inputMode="decimal" value={value}
                onChange={(event) => patch({ profile: draft.profile.map((item, i) => i === index ? item.map((coordinate, j) => j === axis ? event.target.value : coordinate) as [string, string] : item) })} />
            </Field>)}
            <Button compact disabled={draft.profile.length <= 3} onClick={() => patch({ profile: draft.profile.filter((_, i) => i !== index) })}>移除点 {index + 1}</Button>
          </div>)}
          <Button compact disabled={draft.profile.length >= 2000} onClick={() => patch({ profile: [...draft.profile, ["", ""]] })}>增加轮廓点</Button>
          {errors.profile && <p role="alert" className="gj-alert gj-alert--warning">{errors.profile}</p>}
        </div>}
        {textField("sourceLocation", "资料位置", 500)}
        <div className="sc-component-evidence" role="group" aria-label="引用资料" tabIndex={-1} aria-invalid={Boolean(errors.evidence)}>
          <strong>引用资料（必填）</strong>
          {snapshot.evidences.map((evidence) => <div className="gj-row" key={evidence.id}>
            <label><input type="checkbox" checked={draft.evidenceRefs.includes(evidence.id)} disabled={evidence.dataStatus !== "available" && !draft.evidenceRefs.includes(evidence.id)}
              onChange={(event) => patch({ evidenceRefs: event.target.checked ? [...draft.evidenceRefs, evidence.id] : draft.evidenceRefs.filter((ref) => ref !== evidence.id) })} /> {evidence.title}{evidence.dataStatus !== "available" ? "（不可用）" : ""}</label>
            <Button compact onClick={() => onShowEvidence(evidence.id)}>预览资料</Button>
          </div>)}
          {draft.evidenceRefs.filter((ref) => !snapshot.evidences.some((item) => item.id === ref)).map((ref) => <Button key={ref} compact onClick={() => patch({ evidenceRefs: draft.evidenceRefs.filter((id) => id !== ref) })}>移除缺失资料引用</Button>)}
          {errors.evidence && <p role="alert" className="gj-alert gj-alert--warning">{errors.evidence}</p>}
        </div>
        <details>
          <summary>待确认内容与原有参数</summary>
          {original?.unknowns.map((item, index) => <p className="gj-note" key={index}>已记待确认：{item.description}；所需资料：{item.requiredEvidence.join("、")}</p>)}
          {original?.parameters.map((item) => <p className="gj-note" key={item.id}>保留参数：{item.name} · {"exactValue" in item ? item.exactValue : item.value} {item.unit}</p>)}
          <Field label="新增待确认说明" error={errors.unknownDescription ?? null}><textarea aria-invalid={Boolean(errors.unknownDescription)} aria-label="新增待确认说明" maxLength={2000} value={draft.unknownDescription} onChange={(event) => patch({ unknownDescription: event.target.value })} /></Field>
          <Field label="所需补充资料" error={errors.requiredEvidence ?? null}><input aria-invalid={Boolean(errors.requiredEvidence)} aria-label="所需补充资料" maxLength={300} value={draft.requiredEvidence} onChange={(event) => patch({ requiredEvidence: event.target.value })} /></Field>
          <p className="gj-note">原有参数、未确认说明和构件连接保持原样。未声明连接不代表已完成连接核对。</p>
        </details>
        <p className="gj-alert gj-alert--info">本次保存：{draft.name || "未命名构件"}，{LENGTH_FIELDS[draft.kind].map((field) => GEOMETRY_LENGTH_LABELS[field] + " " + (draft.bindings[field] ? bindingDimension(snapshot, draft.bindings[field]!)?.valueMm ?? "引用失效" : draft.lengths[field] || "未填")).join("；")} mm。保存后需重新生成模型和图纸，旧成果保留。</p>
        {errors.form && <p role="alert" className="gj-alert gj-alert--warning">{errors.form}</p>}
        <div className="gj-actions"><Button onClick={showPreview}>预览待核对形体</Button><Button type="submit" variant="primary" busy={saving}>{hasCandidates ? "核对并保存构件输入" : "保存构件输入"}</Button><Button onClick={onCancel}>取消</Button></div>
      </fieldset>
      {changed && <Button onClick={onCancel}>取消编辑</Button>}
      {status && <p role="status" className="gj-alert gj-alert--warning">{status}</p>}
      {(previewStatus || (preview && !currentPreview)) && <p role="status" className="gj-alert gj-alert--info">{previewStatus || "来源资料已变化，旧形体已清除，请重新预览。"}</p>}
      {currentPreview?.component && <section className="sc-draft-preview" aria-label="待核对形体预览">
        <div className="gj-row"><strong>{currentPreview.component.displayNameZh}</strong><Tag>待核对形体</Tag><Tag>材料：{/unknown|未知/i.test(currentPreview.component.materialCode) ? "未知" : currentPreview.component.materialCode}</Tag></div>
        <p className="gj-note">本形体用于核对当前参数。核对保存后，再进入现有模型制作。</p>
        <DraftGeometryViewer component={currentPreview.component} onSelect={(stableKey) => {
          if (stableKey !== currentPreview.component?.stableKey) return;
          const selection = currentPreview.component.candidateSource;
          const row = selection ? candidateComponent(snapshot, selection) : null;
          if (row && selection) onSelectCandidate?.(selection);
          const evidenceId = row?.evidenceRef ?? currentPreview.component.evidenceRefs[0] ?? currentPreview.sources.find((item) => item.evidenceId)?.evidenceId;
          if (evidenceId) onShowEvidence(evidenceId);
          sourcesPanel.current?.focus({ preventScroll: true });
        }} />
        <div ref={sourcesPanel} tabIndex={-1} className="sc-draft-preview__sources" aria-label="预览参数来源">
          <strong>参数与来源</strong>
          {currentPreview.sources.map((source) => <div className="sc-draft-preview__source" key={source.field}>
            <strong>{GEOMETRY_LENGTH_LABELS[source.field]}</strong><span>当前值：{source.kind === "candidate" ? draft.lengths[source.field] : source.valueMm} mm</span>
            <span>原标注：{source.originalText || "人工填写"}；来源：{source.kind === "candidate" ? "待核对候选" : source.kind === "adopted" ? "已采用尺寸" : "人工填写"}</span>
            <span>{source.name}{source.locationText ? " · " + source.locationText : ""}</span>
            {source.evidenceId && <Button compact onClick={() => showParameterEvidence(source.evidenceId, source.region)}>查看参数原件：{snapshot.evidences.find((item) => item.id === source.evidenceId)?.title ?? "原资料"}</Button>}
          </div>)}
        </div>
      </section>}
    </form>
  );
}
interface PanelProps extends Omit<Props, "base" | "initialDraft" | "onCancel"> {
  selection?: ComponentCandidateSelection | null | undefined;
  onSelectionHandled?: (() => void) | undefined;
}
export function ComponentInputPanel({ snapshot, onSave, onSaveDraft, onShowEvidence, selection, onSelectionHandled, onSelectCandidate }: PanelProps) {
  const inputs = componentInputs(snapshot);
  const [editing, setEditing] = useState<{ base?: ComponentInput | undefined; initialDraft?: ComponentDraft | undefined; key: string } | null>(null);
  const [selectionStatus, setSelectionStatus] = useState("");
  const displayOnly = snapshot.geometrySpecs.length > 0 && !snapshot.facts.some((fact) => fact.field.startsWith("geometry.component."));
  const candidates = snapshot.candidates.flatMap((candidate) => candidate.structured?.kind === "componentRecognition" && candidate.reviewStatus !== "rejected" && candidate.reviewStatus !== "superseded"
    ? candidate.structured.components.map((row, rowIndex) => ({ row, selection: { candidateId: candidate.id, rowIndex } })) : []);
  const selectCandidate = (source: ComponentCandidateSelection) => {
    const initialDraft = candidateComponentDraft(snapshot, source);
    if (!initialDraft || displayOnly) { setSelectionStatus(displayOnly ? "当前展示模型不支持反写制作输入。" : "候选或其原件已不可用，请返回预览核对。"); return; }
    const base = candidateComponentInput(snapshot, source);
    setEditing({ base, initialDraft, key: crypto.randomUUID() }); setSelectionStatus("");
    onSelectCandidate?.(source); onShowEvidence(candidateComponent(snapshot, source)?.evidenceRef ?? initialDraft.evidenceRefs[0]!);
  };
  useEffect(() => {
    if (!selection) return;
    if (editing) setSelectionStatus("请先保存或取消当前构件编辑。");
    else selectCandidate(selection);
    onSelectionHandled?.();
  }, [selection?.candidateId, selection?.rowIndex]);
  return <section className="sc-component-input-panel">
    <div className="gj-row"><strong>构件制作输入</strong><Tag>{inputs.length} 条</Tag></div>
    {displayOnly ? <p className="gj-note">当前模型来自已完成的展示包，没有原始构件输入记录。请在空项目中依资料制作，本页不把展示模型反写为测绘记录。</p> : <>
      <p className="gj-note">补齐构件参数后，可用已采用尺寸或候选尺寸预览待核对形体，核对后保存构件输入。当前支持长方体、圆柱体和轮廓挤出。</p>
      {!editing && !!candidates.length && <div className="gj-pane-list" aria-label="待核对构件">{candidates.map(({ row, selection: source }) => {
        const existing = candidateComponentInput(snapshot, source);
        return <Button key={source.candidateId + ":" + source.rowIndex} disabled={Boolean(editing) || !candidateComponent(snapshot, source)} onClick={() => selectCandidate(source)}>{existing ? "编辑识别构件：" + existing.displayNameZh : "完善识别构件：" + row.nameZh}</Button>;
      })}</div>}
      {!editing && inputs.filter((input) => !input.candidateSource || !candidates.some((item) => item.selection.candidateId === input.candidateSource?.candidateId && item.selection.rowIndex === input.candidateSource?.rowIndex)).map((input) => <Button key={input.stableKey} disabled={Boolean(editing)} onClick={() => {
        setEditing({ base: input, key: crypto.randomUUID() });
        const source = input.candidateSource;
        const row = source ? candidateComponent(snapshot, source) : null;
        if (source && row) onSelectCandidate?.(source);
        const evidenceId = row?.evidenceRef ?? input.evidenceRefs[0];
        if (evidenceId) onShowEvidence(evidenceId);
      }}>编辑输入：{input.displayNameZh}</Button>)}
      {!editing && <Button variant="primary" disabled={!snapshot.evidences.some((item) => item.dataStatus === "available")} onClick={() => setEditing({ key: crypto.randomUUID() })}>新增构件输入</Button>}
      {!snapshot.evidences.length && <p className="gj-note">请先在资料页添加本项目资料。</p>}
      {editing && <GeometryComponentEditor key={editing.key} snapshot={snapshot} base={editing.base} initialDraft={editing.initialDraft} onSave={onSave} onSaveDraft={onSaveDraft} onCancel={() => setEditing(null)} onShowEvidence={onShowEvidence} onSelectCandidate={onSelectCandidate} />}
    </>}
    {componentEntries(snapshot).filter((entry) => entry.problem).map(({ input, problem }) => <p role="status" className="gj-note" key={input.stableKey}>失效制作输入：{input.displayNameZh}。{problem}历史记录保留。</p>)}
    {selectionStatus && <p role="status">{selectionStatus}</p>}
  </section>;
}




