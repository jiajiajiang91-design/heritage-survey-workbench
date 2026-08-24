import { useMemo, useState } from "react";
import type { ProjectHead } from "@gujian/application";

import { ENTITY_ORIGIN_LABELS, PRODUCER_LABELS } from "../labels";
import { EvidencePane } from "../shell/EvidencePane";
import { Button, EmptyState, InfoRow, SourceTag, Tag } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";
import { FallbackBanner } from "./Dialogs";
import "./ComponentList.css";

// W04 构件清单（66:1787）：左卡构件（标题行带计数标签，每个构件一张小卡：短编号、来源标签、
// 名称 · 类型名），右卡对应照片（图 278、编号与名称 14/22、说明 13/22、追溯编号信息行、底部操作）。
// 短编号按项目内序号生成（裁决记录第三节第 9 条），追溯编号留在详情里可查。
type Snapshot = ProjectHead["snapshot"];
type GeometryObject = Snapshot["geometrySpecs"][number]["objects"][number];
type Entity = Snapshot["entities"][number];

const PAGE_SIZE = 60;

export interface ComponentListProps {
  snapshot: Snapshot;
  objects: readonly GeometryObject[];
  unknowns: readonly { id: string; description: string; blocksFormalEligibility: boolean }[];
  pane: EvidencePaneModel;
  typeLabel: (componentType: string, conceptRef?: string) => string;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  onOpenInModel: (id: string) => void;
  // 模型服务未配置凭证时在顶部给一条警示（B03），识别不会运行
  modelConfigured: boolean;
  // 有复核签发记录时，待确认项按复核已接受的建模说明显示（实施单元 09）
  signedOff: boolean;
}

export function shortCode(index: number): string {
  return `C-${String(index + 1).padStart(3, "0")}`;
}

function objectDescription(object: GeometryObject, evidenceTitles: readonly string[], unknownCount: number, signedOff: boolean): string {
  const source = object.producer.producerType;
  const head = source === "rule" ? "由形制规则推算" : source === "demo" ? "来自演示数据" : source === "model" ? "由 AI 识别产生" : source === "human" ? "经人工确认" : PRODUCER_LABELS[source] ?? source;
  const evidence = evidenceTitles.length ? `，依据 ${evidenceTitles.slice(0, 3).join("、")}${evidenceTitles.length > 3 ? `等 ${evidenceTitles.length} 份资料` : ""}` : "，未引用项目资料";
  const unknown = unknownCount ? `，${unknownCount} 条${signedOff ? "建模说明" : "待确认"}` : "";
  return `${head}${evidence}${unknown}。`;
}

export function ComponentList({ snapshot, objects, unknowns, pane, typeLabel, selectedObjectId, onSelectObject, onOpenInModel, modelConfigured, signedOff }: ComponentListProps) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [fallbackDismissed, setFallbackDismissed] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hint, setHint] = useState(false);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const object of objects) counts.set(object.componentType, (counts.get(object.componentType) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [objects]);
  const indexed = useMemo(() => objects.map((object, index) => ({ object, code: shortCode(index) })), [objects]);
  const visible = (typeFilter === "all" ? indexed : indexed.filter((item) => item.object.componentType === typeFilter));
  const shown = visible.slice(0, limit);
  const selected = indexed.find((item) => item.object.id === selectedObjectId) ?? null;
  const selectedUnknowns = selected ? unknowns.filter((item) => selected.object.unknownRefs.includes(item.id)) : [];
  const selectedEvidenceTitles = selected?.object.evidenceRefs
    .map((ref) => snapshot.evidences.find((item) => item.id === ref || ref.endsWith(item.id))?.title)
    .filter((title): title is string => Boolean(title)) ?? [];
  const entities: readonly Entity[] = snapshot.entities;
  // 选构件时右卡切到它引用的第一张能显示的照片（v4 右卡没有切换下拉）；没有引用时保持当前资料
  const showEvidenceOf = (refs: readonly string[]) => {
    const candidates = refs.map((ref) => snapshot.evidences.find((item) => item.id === ref)).filter((item): item is Snapshot["evidences"][number] => item !== undefined && item.dataStatus === "available");
    const target = candidates.find((item) => item.evidenceType === "photo") ?? candidates[0];
    if (target) pane.setActiveEvidenceId(target.id);
  };

  return (
    <>
    {!modelConfigured && !fallbackDismissed && <FallbackBanner onDismiss={() => setFallbackDismissed(true)} />}
    <SplitPane
      data={(
        <>
          <div className="gj-pane-head">
            <span className="gj-pane-title">构件</span>
            <Tag>{objects.length} 个对象{entities.length ? ` · ${entities.length} 条构件记录` : ""}</Tag>
          </div>
          {typeCounts.length > 1 && (
            <select className="sc-components-filter" aria-label="按构件类型筛选" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setLimit(PAGE_SIZE); }}>
              <option value="all">全部类型（{objects.length}）</option>
              {typeCounts.map(([type, count]) => <option key={type} value={type}>{typeLabel(type)}（{count}）</option>)}
            </select>
          )}
          {objects.length === 0 && entities.length === 0 && (
            <EmptyState>还没有构件。构件只能来自本项目的资料，或本项目已核对过的三维模型。</EmptyState>
          )}
          <div className="gj-pane-list">
            {shown.map(({ object, code }) => (
              <button type="button" className="gj-list-card" key={object.id} aria-current={object.id === selectedObjectId ? "true" : undefined} onClick={() => { onSelectObject(object.id); showEvidenceOf(object.evidenceRefs); }}>
                <div className="gj-list-card-head">
                  <span className="gj-list-card-title">{code}</span>
                  <SourceTag producerType={object.producer.producerType} />
                </div>
                <span className="gj-list-card-sub">{object.displayNameZh} · {typeLabel(object.componentType, object.conceptRef)}{object.unknownRefs.length ? ` · ${object.unknownRefs.length} 条${signedOff ? "说明" : "待确认"}` : ""}</span>
              </button>
            ))}
            {visible.length > shown.length && (
              <Button onClick={() => setLimit((current) => current + PAGE_SIZE)}>显示更多（还有 {visible.length - shown.length} 个）</Button>
            )}
            {/* 记录级构件与几何对象并列显示，不是二选一：框选新增与识别确认写的是记录级构件。
                排除与遮挡都要在行上看得出来，排除不删记录只标出来。 */}
            {entities.map((entity) => {
              const excluded = snapshot.exclusionRecords.some((record) => record.originRef === entity.id);
              return (
                <div className="gj-list-card" key={entity.id}>
                  <div className="gj-list-card-head">
                    <span className="gj-list-card-title">{entity.name}</span>
                    <span className="gj-row">
                      {excluded && <Tag tone="danger">已排除</Tag>}
                      {entity.visibility && <Tag tone="warning">不可见 · {entity.visibility.needsReshoot ? "需补拍" : "无需补拍"}</Tag>}
                      <Tag>{ENTITY_ORIGIN_LABELS[entity.origin ?? "import"]}</Tag>
                    </span>
                  </div>
                  <span className="gj-list-card-sub">{entity.entityType} · {entity.locationText ?? "未记位置"}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      aside={(
        <EvidencePane
          // 这一栏叫对应照片，就只列照片；把清单 JSON 一类的记录文件整篇灌进来会名不副实
          evidences={snapshot.evidences.filter((item) => item.evidenceType === "photo")}
          pane={pane}
          title="对应照片"
          emptyHint={snapshot.evidences.some((item) => item.evidenceType === "photo") ? "选择资料查看构件对应的照片。" : "本项目没有照片资料。构件来源可在下方详情与三维模型里核对。"}
          caption={selected ? (
            <div className="sc-components-caption">
              <strong>{selected.code} · {selected.object.displayNameZh}</strong>
              <p>{objectDescription(selected.object, selectedEvidenceTitles, selectedUnknowns.length, signedOff)}{pane.activeEvidenceId ? "" : " 照片原件未随包提供或未选择，无法回溯到图像位置。"}</p>
            </div>
          ) : null}
          detail={(
            <>
              {selected && (
                <div className="gj-card gj-card--compact">
                  <InfoRow label="项目内追溯编号" value={<span className="gj-numeric">{selected.object.stableKey}</span>} trailing={<SourceTag producerType={selected.object.producer.producerType} />} />
                  <InfoRow label="构件类型" value={typeLabel(selected.object.componentType, selected.object.conceptRef)} />
                  {selectedEvidenceTitles.map((title) => <InfoRow key={title} label="资料来源" value={title} />)}
                  {selectedUnknowns.map((unknown) => (
                    <InfoRow key={unknown.id} label={signedOff ? "建模说明" : "待确认"} value={unknown.description} trailing={signedOff ? <Tag tone="success">复核已接受</Tag> : <Tag tone={unknown.blocksFormalEligibility ? "danger" : "warning"}>{unknown.blocksFormalEligibility ? "签发前要处理" : "不影响签发"}</Tag>} />
                  ))}
                </div>
              )}
              {!selected && objects.length > 0 && <p className="gj-pane-desc">点击左侧构件，查看编号、依据的资料和说明。</p>}
              {hint && <p className="gj-alert gj-alert--info">在上方照片上拖出一个框，再在右侧助手里说要改什么，例如：这里漏了一个雀替。</p>}
              <span className="gj-spacer" />
              <div className="gj-actions">
                <Button onClick={() => setHint(true)} disabled={!pane.evidencePreview}>框选修正</Button>
                <Button variant="primary" disabled={!selected} onClick={() => { if (selected) onOpenInModel(selected.object.id); }}>在模型中查看</Button>
              </div>
            </>
          )}
        />
      )}
    />
    </>
  );
}
