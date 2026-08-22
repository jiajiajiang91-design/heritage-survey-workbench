import { useState } from "react";
import type { FormEvent } from "react";
import type { ProjectHead } from "@gujian/application";

import { EvidenceMarquee } from "../EvidenceMarquee";
import { DATA_STATUS_LABELS, EVIDENCE_TYPE_LABELS, OBSERVATION_LABELS, PARSE_STATUS_LABELS } from "../labels";
import { Alert, Button, DataStatusTag, InfoRow, SourceTag, Tag } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";
import "./ConditionRecord.css";

// W05 现状记录（66:1927）：左卡照片 420 高、判断内容、底部操作；右卡记录事实（四张信息行：判断类型、
// 记录对象、依据资料、本项目已有记录）与证据来源卡。只记录当前资料上可见的内容（PRD F06）。
type Snapshot = ProjectHead["snapshot"];

export interface ConditionRecordProps {
  snapshot: Snapshot;
  pane: EvidencePaneModel;
  archetypeDifferences: readonly { dimension: string }[];
  evidenceTitle: (ref: string) => string;
  onRecord: (values: { observationType: string; subjectRef: string; evidenceRef: string; text: string }) => Promise<boolean>;
  onEnterIssues: () => void;
}

export function ConditionRecord({ snapshot, pane, archetypeDifferences, evidenceTitle, onRecord, onEnterIssues }: ConditionRecordProps) {
  const [observationType, setObservationType] = useState("visibleCondition");
  const [subjectRef, setSubjectRef] = useState("");
  const [text, setText] = useState("");
  const [showExisting, setShowExisting] = useState(false);
  const evidenceRef = pane.activeEvidenceId ?? snapshot.evidences[0]?.id ?? "";
  const evidence = snapshot.evidences.find((item) => item.id === evidenceRef) ?? null;
  const parse = evidence ? snapshot.parseRecords.find((record) => record.evidenceId === evidence.id)?.status ?? null : null;
  const existing = snapshot.observations.length + snapshot.relations.length;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await onRecord({ observationType, subjectRef, evidenceRef, text });
    if (ok) { setText(""); setSubjectRef(""); }
  };

  return (
    <form className="sc-condition" onSubmit={(event) => void submit(event)}>
      <SplitPane
        initialRatio={57}
        data={(
          <>
            {pane.evidencePreview && pane.evidencePreview.mimeType.startsWith("image/") ? (
              <div className="sc-condition-photo">
                <EvidenceMarquee
                  src={pane.evidencePreview.url}
                  alt={`${pane.evidencePreview.fileName} 原件`}
                  selection={pane.imageSelection?.evidenceId === pane.evidencePreview.evidenceId ? pane.imageSelection.rectNormalized : null}
                  onSelect={(rect) => pane.setImageSelection(rect ? { evidenceId: pane.evidencePreview!.evidenceId, rectNormalized: rect } : null)}
                />
              </div>
            ) : (
              <div className="sc-condition-photo sc-condition-photo--empty">
                {evidence ? (evidence.dataStatus === "available" ? "该资料不是图片，无法在此显示。" : `${evidence.title}：原件未随项目提供。`) : "还没有资料。现状判断必须指向一份项目资料。"}
              </div>
            )}
            {archetypeDifferences.length > 0 && (
              <Alert tone="warning">有 {archetypeDifferences.length} 项实测尺寸超出按形制推算的允许偏差，建议记入现状：{archetypeDifferences.map((item) => item.dimension).join("、")}。</Alert>
            )}
            <label className="sc-condition-text">
              <span className="gj-text-note">判断内容</span>
              <textarea value={text} onChange={(event) => setText(event.target.value)} required placeholder="例如：西侧檐柱柱脚可见糟朽，范围约柱高下部三分之一" />
            </label>
            <span className="gj-spacer" />
            <div className="gj-actions">
              <Button type="submit" disabled={!snapshot.evidences.length}>记录并绑定来源</Button>
              <Button variant="primary" onClick={onEnterIssues}>进入问题队列</Button>
            </div>
          </>
        )}
        aside={(
          <>
            <span className="gj-pane-title">记录事实</span>
            <div className="gj-card gj-card--compact">
              <InfoRow
                label="判断类型"
                value={(
                  <select className="sc-condition-select" value={observationType} onChange={(event) => setObservationType(event.target.value)} aria-label="判断类型">
                    {Object.entries(OBSERVATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                )}
                trailing={<SourceTag producerType="human" />}
              />
            </div>
            <div className="gj-card gj-card--compact">
              <InfoRow
                label="记录对象"
                value={<input className="sc-condition-input" value={subjectRef} onChange={(event) => setSubjectRef(event.target.value)} placeholder="整栋建筑（可填构件稳定键）" aria-label="记录对象" />}
                trailing={<Tag>{subjectRef.trim() ? "已指定构件" : "未指定构件"}</Tag>}
              />
            </div>
            <div className="gj-card gj-card--compact">
              <InfoRow
                label="依据资料"
                value={(
                  <select className="sc-condition-select" value={evidenceRef} onChange={(event) => pane.setActiveEvidenceId(event.target.value || null)} aria-label="依据资料" required>
                    <option value="" disabled>选择一份资料</option>
                    {snapshot.evidences.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                )}
                trailing={evidence ? <DataStatusTag status={evidence.dataStatus} label={DATA_STATUS_LABELS[evidence.dataStatus] ?? evidence.dataStatus} /> : undefined}
              />
            </div>
            <div className="gj-card gj-card--compact">
              <InfoRow label="本项目已有记录" value={`${existing} 条`} trailing={existing ? <Tag tone="success">已记录</Tag> : <Tag tone="warning">待记录</Tag>} />
            </div>
            <span className="gj-text-label">证据来源</span>
            {evidence ? (
              <div className="sc-condition-source">
                <DataStatusTag status={evidence.dataStatus} label={DATA_STATUS_LABELS[evidence.dataStatus] ?? evidence.dataStatus} />
                <strong>{evidence.title}</strong>
                <span>{EVIDENCE_TYPE_LABELS[evidence.evidenceType] ?? evidence.evidenceType} · {parse ? PARSE_STATUS_LABELS[parse] ?? parse : "尚未读取"}</span>
                {evidence.dataStatus !== "available" && <span>原件未随包提供，绑定来源后仍可写入记录</span>}
              </div>
            ) : <p className="gj-pane-desc">上传资料后才能绑定来源。</p>}
            {existing > 0 && (
              <>
                <button type="button" className="sc-condition-toggle" onClick={() => setShowExisting((value) => !value)} aria-expanded={showExisting}>
                  {showExisting ? "收起已有记录" : `查看已有记录（${existing}）`}
                </button>
                {showExisting && (
                  <div className="sc-condition-existing">
                    {snapshot.observations.map((observation) => (
                      <div className="gj-list-card" key={observation.id}>
                        <div className="gj-list-card-head"><span className="gj-list-card-title">{OBSERVATION_LABELS[observation.observationType] ?? observation.observationType}</span><SourceTag producerType={observation.producer.producerType} /></div>
                        <span className="gj-list-card-sub">{observation.text}</span>
                        <span className="gj-list-card-sub">依据：{observation.evidenceRefs.map(evidenceTitle).join("、") || "未指明资料"}</span>
                      </div>
                    ))}
                    {snapshot.relations.map((relation) => (
                      <div className="gj-list-card" key={relation.id}>
                        <div className="gj-list-card-head"><span className="gj-list-card-title">{relation.relationType}</span><SourceTag producerType={relation.producer.producerType} /></div>
                        <span className="gj-list-card-sub">{relation.fromRef} 至 {relation.toRef}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      />
    </form>
  );
}
