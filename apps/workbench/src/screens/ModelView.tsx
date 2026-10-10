import { useEffect, useMemo, useState } from "react";

import type { ProjectHead } from "@gujian/application";
import type { GeometryRevision } from "@gujian/domain";
import { taskOutputUnit } from "@gujian/domain";
import { UNIT_LABELS } from "../production-task";

import { GlbViewer } from "../GlbViewer";
import { cadPhaseLabel } from "../labels";
import { LongTask } from "../LongTask";
import { Button, EmptyState, InfoRow, SourceTag, Tag } from "../ui";
import type { Jobs } from "../workbench/useJobs";
import { shortCode } from "./ComponentList";
import { objectSourceModel } from "../object-source-model";
import { EvidencePane } from "../shell/EvidencePane";
import type { EvidencePane as Pane } from "../workbench/useEvidencePane";
import { triggerDownload } from "../workbench/download";
import "./ModelView.css";

// W06 三维模型（66:2766）：左卡视口（工具条 36、画布 488、图例 44），右卡对象树（行 36，按类型分组计数）。
// 构件、构件连接、待确认三个计数与图例一一对应，待确认部位在模型里可见（PRD F07）。
type Snapshot = ProjectHead["snapshot"];
type GeometrySpec = Snapshot["geometrySpecs"][number];

export interface ModelViewProps {
  // 有复核签发记录时，模型上的待确认部位按复核已接受的建模说明显示（实施单元 09）
  signedOff: boolean;
  snapshot: Snapshot;
  geometryRevision: GeometryRevision | null;
  geometrySpec: GeometrySpec | null;
  geometryBlob: Blob | null;
  geometryGate: { ready: boolean; missing: string[] } | null;
  jobs: Jobs;
  typeLabel: (componentType: string, conceptRef?: string) => string;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  onEditComponents: () => void;
  onEditTask?: () => void;
  pane?: Pane;
  onReviewDimension?: (selection: { candidateId: string; rowIndex: number }) => void;
  onEnterIssues?: (issueId: string) => void;
}

export function ModelView({ snapshot, geometryRevision, geometrySpec, geometryBlob, geometryGate, jobs, typeLabel, selectedObjectId, onSelectObject, onEditComponents, onEditTask, signedOff, pane, onReviewDimension, onEnterIssues }: ModelViewProps) {
  const outputUnit = taskOutputUnit(snapshot);
  const unitChanged = Boolean(geometryRevision) && (geometrySpec?.outputUnit ?? "mm") !== outputUnit;
  const [showUnknowns, setShowUnknowns] = useState(false);
  const objects = geometrySpec?.objects ?? [];
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const object of objects) counts.set(object.componentType, (counts.get(object.componentType) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [objects]);
  const selectedIndex = objects.findIndex((object) => object.id === selectedObjectId);
  const selected = selectedIndex >= 0 ? objects[selectedIndex]! : null;
  const selectedUnknowns = selected ? (geometrySpec?.unknowns ?? []).filter((item) => selected.unknownRefs.includes(item.id)) : [];
  const building = snapshot.buildings[0];
  const canGenerate = Boolean(geometryGate?.ready) && !jobs.geometryRunning;
  const source = selected ? objectSourceModel(snapshot, selected) : null;
  useEffect(() => {
    if (!pane || !source) return;
    const id = source.candidateEvidenceId ?? source.evidenceIds.find((ref) => snapshot.evidences.some((item) => item.id === ref && item.dataStatus === "available"));
    pane.setActiveEvidenceId(id ?? null); pane.setImageSelection(null);
  }, [selected?.id, source?.candidateEvidenceId, source?.evidenceIds.join(","), pane?.setActiveEvidenceId]);

  return (
    <div className="sc-model">
      <section className="sc-model-viewport">
        {/* 工具行按 v4（66:2766）只有两枚标签；生成按钮放卡底右侧，成果状态在检查与签发屏与任务卡范围里，不在这里重复 */}
        <div className="sc-model-toolbar">
          <Tag>透视视角</Tag>
          <Tag>按构件着色</Tag>
          <Button compact onClick={onEditComponents}>编辑构件输入</Button>
          {geometryBlob && <Button compact onClick={() => triggerDownload(geometryBlob, (building?.name ?? "建筑") + ".glb")}>下载模型 GLB</Button>}
        </div>
        <div className="sc-model-canvas">
          {unitChanged && <p role="status" className="gj-note">输出单位已改为{UNIT_LABELS[outputUnit]}，当前 IFC 模型文件仍为{UNIT_LABELS[geometrySpec?.outputUnit ?? "mm"]}。请重新生成模型。图纸可按当前单位生成。</p>}
          {jobs.showGeometryTask && (
            <div className="sc-model-task"><LongTask labelZh={`正在生成三维模型：${cadPhaseLabel(jobs.cadProgress?.phase)}`} onCancel={() => void jobs.cancelGeometry()} cancelling={jobs.cadCancelling} /></div>
          )}
          {geometryRevision && geometryBlob ? (
            <GlbViewer blob={geometryBlob} onSelect={onSelectObject} />
          ) : geometryGate && !geometryGate.ready ? (
            <div className="sc-model-gate">
              <strong>请补齐模型制作输入</strong>
              <p className="gj-pane-desc">生成仅使用本项目已有依据的构件参数。请到构件清单新增或编辑输入；缺少的尺寸和构件关系需要补充资料。</p>
              <p className="gj-note">当前缺少：{geometryGate.missing.map((item) => item === "task.confirmed" ? "已确认制作任务" : item === "task.artifactRequirements" ? "出图要求" : item === "geometry.component.*" ? "构件制作输入" : item.startsWith("geometry.dimension.") ? "有效的引用长度" : item.startsWith("geometry.role.") ? typeLabel(item.slice("geometry.role.".length)) + "的输入" : "需要核对的构件参数").join("、")}</p>
              {geometryGate.missing.includes("task.confirmed") && onEditTask && <Button variant="primary" onClick={onEditTask}>确认制作任务</Button>}
              {geometryGate.missing.some((item) => item.startsWith("geometry.")) && <Button variant="primary" onClick={onEditComponents}>填写构件输入</Button>}            </div>
          ) : (
            <EmptyState action={geometryGate?.ready ? <Button variant="primary" compact loadable busy={jobs.geometryRunning} disabled={!canGenerate} onClick={() => void jobs.generateDemoGeometry()}>生成模型</Button> : undefined}>
              还没有三维模型。生成只使用本项目已确认的构件数据，不读取项目以外的文件；生成后可在这里查看构件并核对来源。
            </EmptyState>
          )}
        </div>
        <div className="sc-model-legend">
          <Tag>{objects.length} 个构件</Tag>
          <Tag tone="accent">{geometrySpec?.interfaces.length ?? 0} 处构件连接</Tag>
          <button type="button" className="sc-model-legend-unknown" onClick={() => setShowUnknowns((value) => !value)} aria-expanded={showUnknowns}>
            <Tag tone={geometrySpec?.unknowns.length && !signedOff ? "warning" : "neutral"}>{geometrySpec?.unknowns.length ?? 0} {signedOff ? "条建模说明" : "处待确认"}</Tag>
          </button>
          <span className="gj-spacer" />
          {geometryRevision && (
            <Button variant="primary" loadable busy={jobs.geometryRunning} disabled={!canGenerate} onClick={() => void jobs.generateDemoGeometry()}>重新生成模型</Button>
          )}
        </div>
        {showUnknowns && geometrySpec && geometrySpec.unknowns.length > 0 && (
          <div className="sc-model-unknowns">
            {geometrySpec.unknowns.map((unknown) => (
              <InfoRow key={unknown.id} label={unknown.blocksFormalEligibility ? "影响正式交付" : "不影响正式交付"} value={unknown.description} />
            ))}
          </div>
        )}
      </section>
      <section className="sc-model-tree">
        <span className="gj-pane-title">对象树</span>
        <div className="sc-model-tree-rows">
          <div className="sc-model-tree-row">
            <span>{building?.name ?? "建筑"}</span>
            <span className="gj-spacer" />
            <small>{objects.length} 个构件</small>
          </div>
          {groups.map(([type, count]) => (
            <div className={`sc-model-tree-row sc-model-tree-row--child${selected?.componentType === type ? " is-selected" : ""}`} key={type}>
              <span>{typeLabel(type)}</span>
              <span className="gj-spacer" />
              <small>{count}</small>
            </div>
          ))}
          {!groups.length && <p className="gj-pane-desc">生成模型后按构件类型列出。</p>}
          {objects.slice(0, 60).map((object, index) => <Button key={object.id} compact onClick={() => onSelectObject(object.id)} aria-current={object.id === selectedObjectId ? "true" : undefined}>选择对象：{shortCode(index)} · {object.displayNameZh}</Button>)}
          {objects.length > 60 && <Button compact onClick={onEditComponents}>在构件清单查看全部 {objects.length} 个对象</Button>}
        </div>
        {selected && (
          <div className="sc-model-selected">
            <InfoRow label="选中构件" value={`${shortCode(selectedIndex)} · ${selected.displayNameZh}`} trailing={<SourceTag producerType={selected.producer.producerType} />} />
            <InfoRow label="追溯编号" value={<span className="gj-numeric">{selected.stableKey}</span>} />
            <InfoRow label="依据的资料" value={`${selected.evidenceRefs.length} 份`} />
            {source?.problem && <p role="status" className="gj-alert gj-alert--warning">{source.problem}当前模型保留供查看，重新制作需要有效输入。</p>}
            {source?.modelLengths.map((item) => <InfoRow key={item.label} label={"当前模型 · " + item.label} value={item.value + " mm"} />)}
            {!!source?.changedLengths.length && <div><strong>已修改制作输入</strong><p className="gj-note">下次生成时采用以下长度。</p>{source.changedLengths.map((item) => <InfoRow key={item.label} label={item.label} value={item.value + " mm"} />)}</div>}
            {!!source?.dimensions.length && <div><strong>当前采用尺寸</strong><p className="gj-note">修改后需重新生成模型与图纸。</p>{source.dimensions.map((item) => <div className="gj-card gj-card--compact" key={item.field}>
              <InfoRow label={item.label} value={item.dimension ? item.dimension.name + " · " + item.dimension.valueMm + " mm" : "引用尺寸已失效，需重新核对"} />
              {item.selection && onReviewDimension && <Button compact onClick={() => onReviewDimension(item.selection!)}>核对尺寸：{item.name}</Button>}
            </div>)}</div>}
            {!!source?.issues.length && <div><strong>相关待处理事项</strong>{source.issues.map((issue) => <p key={issue.id}>{issue.description}</p>)}{onEnterIssues && <Button compact onClick={() => onEnterIssues(source.issues[0]!.id)}>处理相关问题</Button>}</div>}
            {selectedUnknowns.map((unknown) => <InfoRow key={unknown.id} label={signedOff ? "建模说明（复核已接受）" : "待确认"} value={unknown.description} />)}
            {pane && source && <EvidencePane evidences={snapshot.evidences} pane={pane} title="对象来源" description="原图区域用于核对来源，不表示三维坐标。" emptyHint="该对象没有可用原件。" switcher
              location={source.candidateEvidenceId === pane.activeEvidenceId ? source.region : null} />}
          </div>
        )}
        {!selected && objects.length > 0 && <p className="gj-pane-desc">点击模型中的构件，查看编号、依据的资料和说明。</p>}
      </section>
    </div>
  );
}
