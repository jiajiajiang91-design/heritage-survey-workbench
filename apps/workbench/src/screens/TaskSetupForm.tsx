import { useRef, useState, type FormEvent } from "react";
import type { ProjectHead } from "@gujian/application";
import { TaskDefinitionSchema } from "@gujian/domain";
import { Alert, Button, Field } from "../ui";
import {
  describeRequirementChanges, requirementsDraft, splitLines, validateRequirements,
  type FieldErrors, type ReferenceOption, type RequirementReferences, type TaskSetupValues,
} from "../task-requirements";
import { ArtifactRequirementsEditor } from "./ArtifactRequirementsEditor";

type Task = ProjectHead["snapshot"]["taskDefinitions"][number];
const taskFieldsSchema = TaskDefinitionSchema.pick({ name: true, scope: true, regulationRefs: true, deliverables: true });
interface Props {
  task: Task | null;
  references: RequirementReferences;
  roleOptions: ReferenceOption[];
  requirementsOnly?: boolean;
  onSubmit: (values: TaskSetupValues) => Promise<boolean>;
  onCancel?: (() => void) | undefined;
}
export function TaskSetupForm({ task, references, roleOptions, requirementsOnly = false, onSubmit, onCancel }: Props) {
  const [initial] = useState(() => ({ task, requirements: requirementsDraft(task?.artifactRequirements) }));
  const [draft, setDraft] = useState(initial.requirements);
  const [name, setName] = useState(task?.name ?? "建筑模型与测绘图纸制作");
  const [scope, setScope] = useState(task?.scope.join("\n") ?? "从已有资料提取尺寸和构件\n制作资料支持范围内的模型与测绘图纸\n核对并导出成果");
  const [regulations, setRegulations] = useState(task?.regulationRefs.join("\n") ?? "");
  const [deliverables, setDeliverables] = useState(task?.deliverables.join("\n") ?? "");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const requirementsResult = validateRequirements(draft, references);
  const fields = requirementsOnly && initial.task
    ? { name: initial.task.name, scope: initial.task.scope, regulationRefs: initial.task.regulationRefs, deliverables: initial.task.deliverables }
    : { name, scope: scope === initial.task?.scope.join("\n") ? initial.task.scope : splitLines(scope),
      regulationRefs: regulations === initial.task?.regulationRefs.join("\n") ? initial.task.regulationRefs : splitLines(regulations),
      deliverables: deliverables === initial.task?.deliverables.join("\n") ? initial.task.deliverables : splitLines(deliverables) };
  const fieldsResult = taskFieldsSchema.safeParse(fields);
  const fieldErrors: FieldErrors = {};
  if (!fieldsResult.success) for (const issue of fieldsResult.error.issues) fieldErrors[String(issue.path[0])] = "请填写有效内容，每行一项，必填项不能为空且须符合字数限制。";
  if (!fields.name.trim()) fieldErrors.name = "请填写任务名称。";
  const hasErrors = !requirementsResult.value || Object.keys(fieldErrors).length > 0;
  const changedTask = initial.task && [
    fields.name !== initial.task.name ? "任务名称已修改" : "",
    JSON.stringify(fields.scope) !== JSON.stringify(initial.task.scope) ? "任务范围已修改" : "",
    JSON.stringify(fields.regulationRefs) !== JSON.stringify(initial.task.regulationRefs) ? "适用规范或项目约定已修改" : "",
    JSON.stringify(fields.deliverables) !== JSON.stringify(initial.task.deliverables) ? "成果目录已修改" : "",
  ].filter(Boolean);
  const changes = initial.task ? [...(changedTask ?? []), ...describeRequirementChanges(initial.requirements, draft)] : [];
  const taskChangedElsewhere = (task?.id ?? null) !== (initial.task?.id ?? null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || taskChangedElsewhere) return;
    setAttempted(true);
    setFailure(null);
    if (hasErrors || !requirementsResult.value) {
      // 展开错误所在区域，使键盘焦点能进入对应字段。
      formRef.current?.querySelectorAll("details").forEach((details) => { details.open = true; });
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      const ok = await onSubmit({ taskName: fields.name, scope: fields.scope, regulationRefs: fields.regulationRefs, deliverables: fields.deliverables, artifactRequirements: requirementsResult.value });
      if (!ok) setFailure("保存未成功。草稿已保留，请查看错误原因并重试。");
    } catch {
      setFailure("保存未成功。草稿已保留，请重试。");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return <form ref={formRef} className="sc-task-form" noValidate onSubmit={(event) => void submit(event)}>
    <p className="gj-note">设置本次需要制作的成果。图幅尺寸和出图比例是制作要求，不代表原始资料已齐备。</p>
    <fieldset className="sc-task-form-fields" disabled={saving}>
      {!requirementsOnly && <>
        <Field label="任务名称" required error={attempted ? fieldErrors.name ?? null : null}><input value={name} maxLength={200} aria-invalid={attempted && Boolean(fieldErrors.name)} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="任务范围（每行一项）" required error={attempted ? fieldErrors.scope ?? null : null}><textarea value={scope} aria-invalid={attempted && Boolean(fieldErrors.scope)} onChange={(event) => setScope(event.target.value)} /></Field>
        <Field label="适用规范或项目约定" error={attempted ? fieldErrors.regulationRefs ?? null : null}><textarea value={regulations} aria-invalid={attempted && Boolean(fieldErrors.regulationRefs)} onChange={(event) => setRegulations(event.target.value)} /></Field>
        <Field label="成果目录（每行一项）" required error={attempted ? fieldErrors.deliverables ?? null : null}><textarea value={deliverables} aria-invalid={attempted && Boolean(fieldErrors.deliverables)} onChange={(event) => setDeliverables(event.target.value)} placeholder="例如：首层平面 DXF、首层平面 PDF、主体模型 GLB" /></Field>
      </>}
      <ArtifactRequirementsEditor value={draft} onChange={setDraft} errors={attempted ? requirementsResult.errors : {}} references={references} roleOptions={roleOptions} />
      {initial.task && <div className="sc-task-form-summary" aria-label="本次变化">
        <strong>本次变化</strong>
        {changes.length ? <ul>{changes.map((change, i) => <li key={i}>{change}</li>)}</ul> : <p>尚未修改已有要求。</p>}
        <p>保存后，新成果需要重新生成。原任务定义和已有成果保留。</p>
        <p>当前影响计算尚未完整覆盖任务到图纸的依赖。请核对相关模型、图纸和检查记录；不能据此判断没有影响。</p>
      </div>}
      <div className="gj-actions">
        <Button variant="primary" type="submit" loadable busy={saving} disabled={saving || taskChangedElsewhere}>{saving ? "正在保存" : task ? "保存任务要求" : "确认任务要求，开始制作"}</Button>
        {onCancel && <Button onClick={onCancel} disabled={saving}>取消修改</Button>}
      </div>
    </fieldset>
    {attempted && hasErrors && <div role="alert"><Alert tone="danger">请检查标红字段。{[...new Set([...Object.values(fieldErrors), ...Object.values(requirementsResult.errors)])].join(" ")}</Alert></div>}
    {failure && <div role="alert"><Alert tone="danger">{failure}</Alert></div>}
    {!saving && taskChangedElsewhere && <Alert tone="warning">任务要求已在其他操作中更新。当前草稿保留，请取消后重新打开最新任务再修改。</Alert>}
  </form>;
}




