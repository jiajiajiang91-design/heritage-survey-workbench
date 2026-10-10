import { useState } from "react";
import type { ProjectGeometryObject } from "@gujian/domain";
import type { ProjectHead } from "@gujian/application";
import { Alert, Button, InfoRow, Metric } from "../ui";
import { readProductionTask, TARGET_LABELS, UNIT_LABELS, type ProductionTaskValues } from "../production-task";
import type { TaskSetupValues, ReferenceOption } from "../task-requirements";
import { TaskSetupForm } from "./TaskSetupForm";
import { ProductionTaskForm } from "./ProductionTaskForm";
import "./TaskCard.css";
type Snapshot = ProjectHead["snapshot"];
export interface TaskCardProps {
  snapshot: Snapshot; confirmedTask: Snapshot["taskDefinitions"][number] | null;
  objectCount: number; objectProducerCounts: Record<string, number>; measuredRecordCount: number;
  qualificationLabel: string | null; demoLimitationZh: string | null; objects: readonly ProjectGeometryObject[]; roleOptions: ReferenceOption[];
  onSubmitTask: (values: TaskSetupValues) => Promise<boolean>;
  onSubmitProduction: (values: ProductionTaskValues) => Promise<boolean>; onEnterEvidence: () => void;
}
export function TaskCard({ snapshot, confirmedTask: task, objectCount, measuredRecordCount, qualificationLabel, demoLimitationZh, objects, roleOptions, onSubmitTask, onSubmitProduction, onEnterEvidence }: TaskCardProps) {
  const [editing, setEditing] = useState<"basic" | "drawing" | null>(null);
  const building = snapshot.buildings.find((b) => b.id === task?.productionSetup?.buildingId) ?? snapshot.buildings[0];
  const views = task?.artifactRequirements?.views ?? [];
  const setup = task?.productionSetup;
  return <div className="sc-task">
    <div className="sc-task-metrics">
      <Metric label="资料" value={snapshot.evidences.length + " 份资料"} note={snapshot.evidences.length ? "原件与读取结果见资料清单" : "尚未上传资料"} />
      <Metric label="构件" value={objectCount + " 个"} note={objectCount ? "来源与模型参数见构件清单" : "尚未生成构件"} />
      <Metric label="图纸设置" value={views.length ? views.length + " 个视图" : "未设置"} note="图纸生成前补齐，资料可先准备" />
    </div>
    {demoLimitationZh && <Alert tone="info"><strong>展示项目的数据范围：</strong>{demoLimitationZh}</Alert>}
    <div className={editing ? "sc-task-content sc-task-content--editing" : "sc-task-content"}>
      <section className="gj-card sc-task-checklist">
        <h3 className="gj-text-section">本次制作任务</h3>
        {editing === "basic" ? <ProductionTaskForm initial={readProductionTask(snapshot)} onCancel={() => setEditing(null)} onSubmit={async (values) => { const ok = await onSubmitProduction(values); if (ok) setEditing(null); return ok; }} /> : <>
          <InfoRow label="建筑" value={building?.name ?? "未登记"} />
          <InfoRow label="任务名称" value={task?.name ?? "尚未填写"} />
          <InfoRow label="制作目的" value={setup ? "现状测绘" : "尚未设置"} />
          <InfoRow label="输出单位" value={setup ? UNIT_LABELS[setup.outputUnit] : "尚未设置"} />
          <InfoRow label="目标成果" value={setup?.targets.map((t) => TARGET_LABELS[t]).join("、") ?? task?.deliverables.join("、") ?? "尚未设置"} />
          <div className="gj-actions"><Button onClick={() => setEditing("basic")}>修改基本设置</Button><Button variant="primary" onClick={onEnterEvidence}>进入资料清单</Button></div>
        </>}
        {editing === "drawing" ? <TaskSetupForm task={task} requirementsOnly={Boolean(task)} onSubmit={async (values) => { const ok = await onSubmitTask(values); if (ok) setEditing(null); return ok; }} onCancel={() => setEditing(null)}
          references={{ components: objects.map((o) => ({ value: o.stableKey, label: o.displayNameZh })), evidences: snapshot.evidences.map((e) => ({ value: e.id, label: e.title })) }} roleOptions={roleOptions} /> :
          <Button onClick={() => setEditing("drawing")}>设置图纸要求</Button>}
      </section>
      <section className="gj-card sc-task-scope"><h3 className="gj-text-section">本次范围</h3>
        <p>单栋建筑：{building?.name ?? "未登记"}</p><p>项目或村落：{setup?.projectGroup ?? "未分组"}</p>
        <p>{measuredRecordCount ? measuredRecordCount + " 条完整现场实测记录" : "尚无完整现场实测记录，已有尺寸来源见核对页面。"}</p>
        {qualificationLabel && snapshot.geometryRevisions.length > 0 && <p>成果状态：{demoLimitationZh ? "展示流程状态" : qualificationLabel}</p>}
        <details><summary>原任务书与项目说明</summary><p>{task?.scope.join("；") ?? "尚未填写任务范围"}</p><p>适用规范：{task?.regulationRefs.join("；") || "尚未填写"}</p>
          <p>资料说明：{snapshot.evidences.map((e) => e.rightsDeclaration).filter(Boolean).join("；") || "原件及补充说明见资料清单"}</p>
        </details>
      </section>
    </div>
  </div>;
}
