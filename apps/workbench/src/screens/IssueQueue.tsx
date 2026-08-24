import { useState } from "react";
import type { ProjectHead } from "@gujian/application";

import { DATA_STATUS_LABELS, ISSUE_TYPE_LABELS } from "../labels";
import { Alert, Button, EmptyState, Field, SourceTag, Tag } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import "./IssueQueue.css";

// W07 问题队列（66:2834）：左卡待处理问题（每条一张 92 高的小卡：标题、类型标签、摘要，选中底 bg/selected），
// 右卡问题详情（标题 16/24、类型标签、说明 13/22、影响范围与阻断卡、资料链卡、底部操作）。
// 问题只能由人工决定关闭（核心 PRD 附录 A.4）；缺资料的问题补资料后由规则自动复检。
type Snapshot = ProjectHead["snapshot"];
type Issue = Snapshot["issues"][number];

export interface IssueQueueProps {
  snapshot: Snapshot;
  openIssues: readonly Issue[];
  taskConfirmed: boolean;
  evidenceTitle: (ref: string) => string;
  humanInterventions: { missingFieldFacts: readonly unknown[]; professionalChoices: readonly unknown[]; groupedReviewRefs: readonly unknown[] } | null;
  onDecideCandidate: (issueId: string, candidateId: string, outcome: "accepted" | "rejected", reason: string) => Promise<boolean>;
  onDecideOption: (issueId: string, outcome: "accepted" | "rejected", optionId: string | null, reason: string) => Promise<boolean>;
  onGoToTask: () => void;
  onGoToEvidence: () => void;
}

function typeTone(issueType: string): "danger" | "warning" {
  return issueType === "missingEvidence" || issueType === "highRisk" ? "danger" : "warning";
}

// 标题取描述第一个句号或逗号前的部分；描述本身就是标题时原样用
function issueTitle(description: string): string {
  const cut = description.split(/[。；：]/)[0] ?? description;
  return cut.length > 28 ? `${cut.slice(0, 28)}…` : cut;
}

function refLabel(ref: string, snapshot: Snapshot, evidenceTitle: (ref: string) => string): string {
  const id = ref.includes(":") ? ref.slice(ref.lastIndexOf(":") + 1) : ref;
  const evidence = snapshot.evidences.find((item) => item.id === id || ref.endsWith(item.id));
  if (evidence) return evidenceTitle(evidence.id);
  const object = snapshot.geometrySpecs.flatMap((spec) => spec.objects).find((item) => item.id === id || item.stableKey === ref);
  if (object) return object.displayNameZh;
  const fact = snapshot.facts.find((item) => item.id === id);
  if (fact) return `尺寸 ${fact.field}`;
  const building = snapshot.buildings.find((item) => item.id === id);
  if (building) return building.name;
  const candidate = snapshot.candidates.find((item) => item.id === id);
  if (candidate) return "待确认的识别结果";
  // 认不出的引用不把裸编号亮给用户；名字说不出就说类别
  return /^[0-9a-f-]{36}$/i.test(id) ? "相关记录" : ref;
}

export function IssueQueue({ snapshot, openIssues, taskConfirmed, evidenceTitle, humanInterventions, onDecideCandidate, onDecideOption, onGoToTask, onGoToEvidence }: IssueQueueProps) {
  const visible = openIssues.filter((issue) => issue.sourceRef !== "rule:task-setup-required");
  const [selectedId, setSelectedId] = useState<string | null>(visible[0]?.id ?? null);
  const [reason, setReason] = useState("");
  const [optionId, setOptionId] = useState<string | null>(null);
  const selected = visible.find((issue) => issue.id === selectedId) ?? visible[0] ?? null;
  const candidate = selected ? snapshot.candidates.find((item) => selected.subjectRefs.includes(item.id)) ?? null : null;
  const canDecideCandidate = Boolean(selected && selected.sourceRef === "rule:model-candidate-review" && candidate?.reviewStatus === "unreviewed");
  const ruleCount = visible.filter((issue) => issue.producer.producerType === "rule").length;
  const formalBlockers = visible.filter((issue) => issue.blocksFormalEligibility).length;
  const proxyBlockers = visible.filter((issue) => issue.blocksProxyOutcome).length;

  const pick = (issue: Issue) => { setSelectedId(issue.id); setReason(""); setOptionId(null); };
  const decideOption = async (outcome: "accepted" | "rejected") => {
    if (!selected) return;
    if (await onDecideOption(selected.id, outcome, optionId, reason)) { setReason(""); setOptionId(null); }
  };
  const decideCandidate = async (outcome: "accepted" | "rejected") => {
    if (!selected || !candidate) return;
    if (await onDecideCandidate(selected.id, candidate.id, outcome, reason)) setReason("");
  };

  return (
    <SplitPane
      initialRatio={48}
      data={(
        <>
          <div className="gj-pane-head">
            <span className="gj-pane-title">待处理问题</span>
            <Tag tone={visible.length ? "warning" : "success"}>{visible.length} 项</Tag>
          </div>
          <p className="gj-pane-desc">
            {visible.length
              ? `${ruleCount} 条由自动核对发现${proxyBlockers ? `，${proxyBlockers} 条影响出图` : ""}${formalBlockers ? `，${formalBlockers} 条签发前要处理` : ""}。`
              : "当前没有需要人工处理的异常。自动规则已完成。"}
          </p>
          {!taskConfirmed && (
            <Alert tone="warning">任务要求尚未确认，成果要求与责任角色缺失。<Button variant="text" compact onClick={onGoToTask}>去任务卡确认</Button></Alert>
          )}
          {/* 分类计数只在有待处理问题时显示；没有问题时列一行零计数只会让人找不存在的那一条 */}
          {humanInterventions && visible.length > 0 && (
            <p className="gj-note">缺现场资料 {humanInterventions.missingFieldFacts.length} · 需专业判断 {humanInterventions.professionalChoices.length}</p>
          )}
          <div className="gj-pane-list">
            {visible.map((issue) => (
              <button type="button" className="sc-issue" key={issue.id} aria-current={selected?.id === issue.id ? "true" : undefined} onClick={() => pick(issue)}>
                <div className="sc-issue-head">
                  <span className="sc-issue-title">{issueTitle(issue.description)}</span>
                  <Tag tone={typeTone(issue.issueType)}>{ISSUE_TYPE_LABELS[issue.issueType] ?? issue.issueType}</Tag>
                </div>
                <span className="sc-issue-summary">{issue.description}</span>
              </button>
            ))}
          </div>
        </>
      )}
      aside={selected ? (
        <>
          <span className="gj-pane-title">{issueTitle(selected.description)}</span>
          <div className="gj-row">
            <Tag tone={typeTone(selected.issueType)}>{ISSUE_TYPE_LABELS[selected.issueType] ?? selected.issueType}</Tag>
            <SourceTag producerType={selected.producer.producerType} />
          </div>
          <p className="sc-issue-body">{selected.description}</p>
          <div className="gj-card gj-card--compact">
            <span className="gj-text-label">影响范围</span>
            <div className="sc-issue-lines">
              {selected.impactRefs.length
                ? selected.impactRefs.slice(0, 6).map((ref) => <span key={ref}>{refLabel(ref, snapshot, evidenceTitle)}</span>)
                : selected.subjectRefs.map((ref) => <span key={ref}>{refLabel(ref, snapshot, evidenceTitle)}</span>)}
              {selected.impactRefs.length > 6 && <span className="gj-note">另有 {selected.impactRefs.length - 6} 项</span>}
              <span>{selected.blocksProxyOutcome ? "影响出图" : "不影响出图"}，{selected.blocksFormalEligibility ? "签发前要处理" : "不影响签发"}</span>
            </div>
          </div>
          <div className="gj-card gj-card--compact">
            <span className="gj-text-label">本项目的 {snapshot.evidences.length} 份资料</span>
            <div className="sc-issue-chain">
              {snapshot.evidences.map((evidence, index) => (
                <span key={evidence.id}>{index + 1}  {evidence.title} · {DATA_STATUS_LABELS[evidence.dataStatus] ?? evidence.dataStatus}</span>
              ))}
              {!snapshot.evidences.length && <span className="gj-note">尚无资料</span>}
            </div>
          </div>
          {selected.options?.length ? (
            <div className="sc-issue-decision">
              <p className="gj-pane-desc">下面几种做法都有依据。选定一种并写明理由，后续版本仍可改。</p>
              {selected.options.map((option) => (
                <label className="sc-issue-option" key={option.optionId}>
                  <input type="radio" name={`issue-option-${selected.id}`} checked={optionId === option.optionId} onChange={() => setOptionId(option.optionId)} />
                  <span><strong>{option.labelZh}</strong><small>{option.valueText}</small><em>{option.sourceText}</em></span>
                </label>
              ))}
              <Field label="理由或备注"><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="选定时可选填；暂不选择时必填" /></Field>
            </div>
          ) : canDecideCandidate ? (
            <div className="sc-issue-decision">
              <p className="gj-pane-desc">这是非唯一的专业取舍，需要一次人工决定。接受只改变候选核对状态，不改变数据来源。</p>
              <Field label="驳回理由"><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="仅在驳回时必填" /></Field>
            </div>
          ) : (
            <p className="gj-pane-desc">{selected.issueType === "missingEvidence" ? "补充或更换资料后，规则会自动复检，不需要手动确认。" : "由对应的人工决定或候选处理动作关闭。"}</p>
          )}
          <span className="gj-spacer" />
          <div className="gj-actions">
            {selected.options?.length ? (
              <>
                <Button onClick={() => void decideOption("rejected")}>暂不选择</Button>
                <Button variant="primary" onClick={() => void decideOption("accepted")}>选定该方案</Button>
              </>
            ) : canDecideCandidate ? (
              <>
                <Button onClick={() => void decideCandidate("rejected")}>驳回候选</Button>
                <Button variant="primary" onClick={() => void decideCandidate("accepted")}>接受为已核对候选</Button>
              </>
            ) : (
              <>
                <Button onClick={onGoToEvidence}>回到资料清单</Button>
                <Button variant="primary" disabled title="这类问题由规则在资料更新后自动复检，不能手工标记">标记已解决</Button>
              </>
            )}
          </div>
        </>
      ) : (
        <EmptyState>{visible.length ? "选择左侧问题查看详情。" : "当前没有待处理问题。"}</EmptyState>
      )}
    />
  );
}
