import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ProjectHead } from "@gujian/application";
import type { GeometryRevision } from "@gujian/domain";

import { GlbViewer } from "../GlbViewer";
import { cadPhaseLabel } from "../labels";
import { LongTask } from "../LongTask";
import { Button, EmptyState, Field, InfoRow, SourceTag, Tag } from "../ui";
import type { Jobs } from "../workbench/useJobs";
import { shortCode } from "./ComponentList";
import "./ModelView.css";

// W06 三维模型（66:2766）：左卡视口（工具条 36、画布 488、图例 44），右卡对象树（行 36，按类型分组计数）。
// 实体、界面、未知项三个计数与图例一一对应，未知项在模型里可见（PRD F07）。
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
  onConfirmGeometryFacts: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function ModelView({ snapshot, geometryRevision, geometrySpec, geometryBlob, geometryGate, jobs, typeLabel, selectedObjectId, onSelectObject, onConfirmGeometryFacts, signedOff }: ModelViewProps) {
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

  return (
    <div className="sc-model">
      <section className="sc-model-viewport">
        {/* 工具行按 v4（66:2766）只有两枚标签；生成按钮放卡底右侧，成果状态在检查与资格屏与任务卡范围里，不在这里重复 */}
        <div className="sc-model-toolbar">
          <Tag>透视视角</Tag>
          <Tag>按构件着色</Tag>
        </div>
        <div className="sc-model-canvas">
          {jobs.showGeometryTask && (
            <div className="sc-model-task"><LongTask labelZh={`正在生成三维模型：${cadPhaseLabel(jobs.cadProgress?.phase)}`} onCancel={() => void jobs.cancelGeometry()} cancelling={jobs.cadCancelling} /></div>
          )}
          {geometryRevision && geometryBlob ? (
            <GlbViewer blob={geometryBlob} onSelect={onSelectObject} />
          ) : geometryGate && !geometryGate.ready ? (
            <div className="sc-model-gate">
              <strong>生成模型前，先从本项目资料逐个确认构件尺寸</strong>
              <p className="gj-pane-desc">每个构件和构件间连接都要能对到本项目的一份资料；不用百分比、固定厚度或其他项目的数据补齐。当前缺少：{geometryGate.missing.join("、")}</p>
              {snapshot.evidences.length > 0 && (
                <form className="sc-model-form" onSubmit={(event) => void onConfirmGeometryFacts(event)}>
                  <Field label="构件数据" required><textarea name="geometryComponents" required placeholder="逐个构件填写：名称、类型、尺寸、依据的资料，以及尚未确认的部分" /></Field>
                  <Field label="构件间连接 JSON" required><textarea name="geometryInterfaces" required placeholder="只填图纸或调查资料能证明的承托、接触、包含或搭接关系；没有依据可留空 []" /></Field>
                  <p className="gj-note">本项目资料：{snapshot.evidences.map((item) => `${item.title}=${item.id}`).join("；")}</p>
                  <div className="gj-actions"><Button variant="primary" type="submit">写入构件尺寸</Button></div>
                </form>
              )}
            </div>
          ) : (
            <EmptyState action={geometryGate?.ready ? <Button variant="primary" compact loadable busy={jobs.geometryRunning} disabled={!canGenerate} onClick={() => void jobs.generateDemoGeometry()}>生成模型</Button> : undefined}>
              还没有三维模型。生成只使用本项目已确认的构件数据，不读取项目以外的文件；生成后可在这里查看构件并核对来源。
            </EmptyState>
          )}
        </div>
        <div className="sc-model-legend">
          <Tag>{objects.length} 个构件</Tag>
          <Tag tone="accent">{geometrySpec?.interfaces.length ?? 0} 个界面</Tag>
          <button type="button" className="sc-model-legend-unknown" onClick={() => setShowUnknowns((value) => !value)} aria-expanded={showUnknowns}>
            <Tag tone={geometrySpec?.unknowns.length && !signedOff ? "warning" : "neutral"}>{geometrySpec?.unknowns.length ?? 0} {signedOff ? "条建模说明" : "处待确认"}</Tag>
          </button>
          <span className="gj-spacer" />
          {geometryRevision && (
            <Button variant="primary" loadable busy={jobs.geometryRunning} disabled={!canGenerate} onClick={() => void jobs.generateDemoGeometry()}>生成新代理版本</Button>
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
        </div>
        {selected && (
          <div className="sc-model-selected">
            <InfoRow label="选中构件" value={`${shortCode(selectedIndex)} · ${selected.displayNameZh}`} trailing={<SourceTag producerType={selected.producer.producerType} />} />
            <InfoRow label="编号" value={<span className="gj-numeric">{selected.stableKey}</span>} />
            <InfoRow label="依据的资料" value={`${selected.evidenceRefs.length} 份`} />
            {selectedUnknowns.map((unknown) => <InfoRow key={unknown.id} label={signedOff ? "建模说明（复核已接受）" : "待确认"} value={unknown.description} />)}
          </div>
        )}
        {!selected && objects.length > 0 && <p className="gj-pane-desc">点击模型中的构件，查看编号、依据的资料和说明。</p>}
      </section>
    </div>
  );
}
