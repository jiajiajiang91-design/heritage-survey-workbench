import { useState } from "react";
import type { FormEvent } from "react";
import type { ProjectHead } from "@gujian/application";

import { EVIDENCE_TYPE_LABELS, PRODUCER_LABELS, RESPONSIBILITY_ROLE_LABELS } from "../labels";
import { Alert, Button, Field, InfoRow, Metric, Tag } from "../ui";
import { readTaskSetupForm, type TaskSetupValues } from "../workbench/useRecordWrites";
import "./TaskCard.css";

// W01 任务卡（66:1599）：三张指标卡，左侧启动检查（信息行加状态标签、底部操作），右侧本次范围。
// 任务未确认时左卡显示确认表单（原问题队列里的表单迁到这里），字段与按钮文案不变。
type Snapshot = ProjectHead["snapshot"];
type TaskDefinition = Snapshot["taskDefinitions"][number];

export interface TaskCardProps {
  snapshot: Snapshot;
  confirmedTask: TaskDefinition | null;
  objectCount: number;
  objectProducerCounts: Record<string, number>;
  measuredRecordCount: number;
  qualificationLabel: string | null;
  demoLimitationZh: string | null;
  onSubmitTask: (values: TaskSetupValues) => Promise<void>;
  onEnterEvidence: () => void;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function evidenceNote(snapshot: Snapshot): string {
  if (!snapshot.evidences.length) return "尚未上传资料";
  const byType = countBy(snapshot.evidences, (item) => EVIDENCE_TYPE_LABELS[item.evidenceType] ?? item.evidenceType);
  const missing = snapshot.evidences.filter((item) => item.dataStatus !== "available").length;
  const parts = Object.entries(byType).map(([label, count]) => `${count} 份${label}`);
  if (missing) parts.push(`${missing} 份缺失`);
  return parts.join("，");
}

function objectNote(count: number, producers: Record<string, number>): string {
  if (!count) return "尚未生成构件";
  const entries = Object.entries(producers);
  if (entries.length === 1) {
    const [type] = entries[0]!;
    return type === "rule" ? "全部由形制规则推算" : type === "demo" ? "全部为演示数据" : `全部为${PRODUCER_LABELS[type] ?? type}`;
  }
  return entries.map(([type, n]) => `${PRODUCER_LABELS[type] ?? type} ${n}`).join("，");
}

function scaleSummary(task: TaskDefinition | null): { value: string; note: string } {
  const views = task?.artifactRequirements?.views ?? [];
  if (!views.length) return { value: "未设置", note: "在下方确认任务要求后显示" };
  const first = views[0]!;
  const scales = [...new Set(views.map((view) => `1:${view.scaleDenominator}`))];
  const others = scales.filter((scale) => scale !== `1:${first.scaleDenominator}`);
  return {
    value: `${first.displayLabelZh} 1:${first.scaleDenominator}`,
    note: others.length ? `另有 ${others.join("、")}，共 ${views.length} 个视图` : `共 ${views.length} 个视图`,
  };
}

function TaskSetupForm({ task, onSubmit }: { task: TaskDefinition | null; onSubmit: (values: TaskSetupValues) => Promise<void> }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(readTaskSetupForm(new FormData(event.currentTarget)));
  };
  const requirements = task?.artifactRequirements ?? null;
  return (
    <form className="sc-task-form" onSubmit={(event) => void submit(event)}>
      <p className="gj-note">成果范围、适用规范和责任人只在任务开始时确认一次。之后能自动判断的检查会直接执行，不再逐项打扰你。</p>
      <Field label="任务名称" required><input name="taskName" required defaultValue={task?.name ?? "资料整理与成果核对"} /></Field>
      <Field label="任务范围（每行一项）" required><textarea name="scope" required defaultValue={task?.scope.join("\n") ?? "整理原始资料\n核对构件\n处理资料缺失\n导出成果"} /></Field>
      <Field label="适用规范或项目约定"><textarea name="regulations" defaultValue={task?.regulationRefs.join("\n") ?? "资料需注明来源，可追溯到原件"} /></Field>
      <Field label="成果目录（每行一项）" required><textarea name="deliverables" required defaultValue={task?.deliverables.join("\n") ?? ""} placeholder="按本次任务要求逐行填写，不套用模板" /></Field>
      <div className="sc-task-form-grid">
        <Field label="图纸标题" required><input name="drawingTitle" required defaultValue={requirements?.titleZh ?? ""} /></Field>
        <Field label="修订标记" required><input name="drawingRevision" required defaultValue={requirements?.revisionLabel ?? ""} placeholder="例如 P1" /></Field>
      </div>
      <Field label="需要出图的构件类型（每行一项）" required><textarea name="geometryTargetRoles" required defaultValue={requirements?.geometryTargetRoles.join("\n") ?? ""} placeholder="例如 柱、墙、屋面；缺一项该图就不生成" /></Field>
      <Field label="图幅设置" required><textarea name="drawingSheets" required defaultValue={requirements ? JSON.stringify(requirements.sheets, null, 2) : ""} placeholder='逐张图填写图号、图名和图幅尺寸，例如：[{"key":"sheet-1","drawingNumber":"P-01","displayLabelZh":"平面与立面","pageMm":[841,594]}]' /></Field>
      <Field label="视图设置" required><textarea name="drawingViews" required defaultValue={requirements ? JSON.stringify(requirements.views, null, 2) : ""} placeholder="逐个视图填写图种、比例、所在图幅、在图上的位置、朝向和对应构件。详图还需指明依据的资料，缺依据则不生成" /></Field>
      <div className="gj-actions">
        <Button variant="primary" type="submit">{task ? "保存新任务版本" : "确认任务要求，开始整理资料"}</Button>
      </div>
    </form>
  );
}

export function TaskCard({ snapshot, confirmedTask, objectCount, objectProducerCounts, measuredRecordCount, qualificationLabel, demoLimitationZh, onSubmitTask, onEnterEvidence }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const building = snapshot.buildings[0];
  const views = confirmedTask?.artifactRequirements?.views ?? [];
  const scales = [...new Set(views.map((view) => `1:${view.scaleDenominator}`))];
  const scale = scaleSummary(confirmedTask);
  // 授权说明逐份资料登记，拼行前去掉句尾句号再合并，重复的只留一条
  const rights = [...new Set(snapshot.evidences
    .map((item) => item.rightsDeclaration)
    .filter((item): item is string => Boolean(item))
    .map((item) => item.replace(/[。；\s]+$/, "")))];
  const roles = confirmedTask?.responsibilities.map((item) => RESPONSIBILITY_ROLE_LABELS[item.role] ?? item.role) ?? [];
  const regulations = confirmedTask?.regulationRefs ?? [];
  const showForm = !confirmedTask || editing;

  const submit = async (values: TaskSetupValues) => {
    await onSubmitTask(values);
    setEditing(false);
  };

  return (
    <div className="sc-task">
      <div className="sc-task-metrics">
        <Metric label="资料" value={`${snapshot.evidences.length} 份资料`} note={evidenceNote(snapshot)} />
        <Metric label="构件" value={`${objectCount} 个`} note={objectNote(objectCount, objectProducerCounts)} />
        <Metric label="成果要求" value={scale.value} note={scale.note} />
      </div>
      {demoLimitationZh && <Alert tone="info"><strong>展示项目的数据边界：</strong>{demoLimitationZh} 项目包中的签发记录来自正式构建环境，本机只能核对，不能新建签发。</Alert>}
      <div className="sc-task-content">
        <section className="gj-card sc-task-checklist">
          <h3 className="gj-text-section">{showForm ? (confirmedTask ? "更新任务要求" : "确认任务要求") : "启动检查"}</h3>
          {showForm ? (
            <>
              <TaskSetupForm task={confirmedTask} onSubmit={submit} />
              {confirmedTask && <div className="gj-actions"><Button onClick={() => setEditing(false)}>取消修改</Button></div>}
            </>
          ) : (
            <>
              <p className="gj-text-body" style={{ color: "var(--text-secondary)" }}>完成后进入资料整理。</p>
              <InfoRow
                label="对象与范围"
                value={[building?.name, views[0] ? `${views[0].displayLabelZh} 1:${views[0].scaleDenominator}` : confirmedTask?.scope[0]].filter(Boolean).join(" · ")}
                trailing={<Tag tone="success">已确认</Tag>}
              />
              <InfoRow
                label="成果目录"
                value={confirmedTask!.deliverables.join("、") || "未填写"}
                trailing={<Tag tone={confirmedTask!.deliverables.length ? "success" : "warning"}>{confirmedTask!.deliverables.length ? "已确认" : "待补"}</Tag>}
              />
              <InfoRow
                label="资料授权"
                value={rights.length ? `${rights.join("；")}。` : snapshot.evidences.length ? "资料未登记授权说明" : "尚未上传资料"}
                trailing={<Tag tone={rights.length ? "success" : "neutral"}>{rights.length ? "已登记" : "待补"}</Tag>}
              />
              <InfoRow
                label="适用规范"
                value={regulations.length ? regulations.join("；") : "未填写"}
                trailing={<Tag tone={regulations.length ? "success" : "warning"}>{regulations.length ? "已确认" : "待补"}</Tag>}
              />
              <span className="gj-spacer" />
              <div className="gj-actions">
                <Button onClick={() => setEditing(true)}>保存任务</Button>
                <Button variant="primary" onClick={onEnterEvidence}>进入资料清单</Button>
              </div>
            </>
          )}
        </section>
        <section className="gj-card sc-task-scope">
          <h3 className="gj-text-section">本次范围</h3>
          <ul className="sc-task-scope-list">
            <li>单栋建筑</li>
            <li>{building?.name ?? "建筑未登记"}</li>
            <li>{scales.length ? `成果比例 ${scales.join("、")}` : "成果比例未设置"}</li>
            <li>{roles.length ? `责任记录 ${roles.length} 条：${roles.join("、")}` : "责任记录未登记"}</li>
            <li>{regulations.length ? `适用规范 ${regulations.length} 项` : "适用规范未填写"}</li>
          </ul>
          <p className="sc-task-scope-note">
            {(() => {
              // 现场实测记录可能是动作层写的逐条记录，也可能是随包入库的实测记录表（资料类型为测量记录）
              const surveyRecords = snapshot.evidences.filter((item) => item.evidenceType === "measurementRecord" && item.dataStatus === "available");
              if (measuredRecordCount) return `本项目有 ${measuredRecordCount} 条完整的现场实测记录。`;
              // 资料标题本身多叫"现场实测记录"，句式再带一遍就成了"尺寸来自现场实测记录：现场实测记录"
              if (surveyRecords.length) return `尺寸依据：${surveyRecords.map((item) => item.title).join("、")}。`;
              return "本项目无现场实测记录，尺寸来自资料转写或形制推算。";
            })()}
            {qualificationLabel ? `成果状态：${demoLimitationZh ? "展示流程已归档，仅供体验" : qualificationLabel}。` : ""}
          </p>
        </section>
      </div>
    </div>
  );
}
