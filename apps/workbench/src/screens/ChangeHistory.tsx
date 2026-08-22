import { useState } from "react";

import type { ChangeHistoryEntry } from "../change-history";
import { RESPONSIBILITY_ROLE_LABELS } from "../labels";
import { ProjectPageFrame } from "../shell/AppShell";
import { Button, EmptyState, Tag } from "../ui";
import "./ChangeHistory.css";

// P03 修改历史（66:3753）：筛选按钮行、写入列表卡（每条 86 高：时间 100、操作人 80、动作、结果标签；
// 第二行写入集灰色、影响范围橙色同一行）。影响由程序按记录引用算出（单元 07），不是人工填的。
export interface ChangeHistoryProps {
  entries: readonly ChangeHistoryEntry[];
  responsibilities: readonly { role: string; actorId: string }[];
  back: { label: string; onBack: () => void };
}

type Filter = "all" | "committed" | "other" | "unnamed";

const OUTCOME_ZH: Record<ChangeHistoryEntry["outcome"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  committed: { label: "已提交", tone: "success" },
  rejected: { label: "已拒绝", tone: "danger" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
  late: { label: "结果已作废", tone: "warning" },
};

function actorLabel(actorId: string, responsibilities: readonly { role: string; actorId: string }[]): string {
  const match = responsibilities.find((item) => item.actorId === actorId);
  return match ? RESPONSIBILITY_ROLE_LABELS[match.role] ?? match.role : "本机操作人";
}

function timeLabel(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

export function ChangeHistory({ entries, responsibilities, back }: ChangeHistoryProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const unnamed = entries.filter((entry) => entry.actionZh === "未记录动作类型");
  const committed = entries.filter((entry) => entry.outcome === "committed");
  const other = entries.filter((entry) => entry.outcome !== "committed");
  const visible = filter === "all" ? entries : filter === "committed" ? committed : filter === "other" ? other : unnamed;
  const filters: [Filter, string, number][] = [["all", "全部", entries.length], ["committed", "已提交", committed.length], ["other", "未生效", other.length], ["unnamed", "缺动作名", unnamed.length]];
  return (
    <ProjectPageFrame
      title="修改历史"
      description="每一次写入都留在这里，含时间、操作人、动作和改了什么。右侧一列是这次写入让哪些下游失效，由程序按记录之间的引用关系算出，不是人工填的。"
      back={back}
    >
      <div className="sc-history-filters">
        {filters.map(([key, label, count]) => (
          <Button key={key} variant={filter === key ? "primary" : "secondary"} onClick={() => setFilter(key)} aria-pressed={filter === key}>{label} {count}</Button>
        ))}
      </div>
      <section className="sc-history-list">
        <span className="gj-pane-title">{filter === "all" ? `全部 ${entries.length} 次写入` : `${visible.length} 次写入`}</span>
        {visible.length ? visible.map((entry) => {
          const outcome = OUTCOME_ZH[entry.outcome];
          const impact = entry.impact;
          return (
            <article className="sc-history-event" key={entry.id}>
              <div className="sc-history-title">
                <span className="sc-history-time">{timeLabel(entry.occurredAt)}</span>
                <span className="sc-history-actor">{actorLabel(entry.actorId, responsibilities)}</span>
                <span className="sc-history-action">{entry.actionZh}</span>
                <span className="gj-spacer" />
                <Tag tone={outcome.tone}>{outcome.label}</Tag>
              </div>
              <div className="sc-history-detail">
                <span className="sc-history-write">
                  写入：{entry.subjectsZh.length ? entry.subjectsZh.join("、") : `${entry.writeCount} 条记录`}
                  {entry.reasonZh ? `。理由：${entry.reasonZh}` : ""}
                </span>
                {impact === null ? (
                  <span className="sc-history-impact sc-history-impact--unknown">影响：算不出来</span>
                ) : impact.total > 0 ? (
                  <span className="sc-history-impact">影响：{impact.groups.map((group) => `${group.kind} ${group.count}`).join("、")}</span>
                ) : (
                  <span className="sc-history-none">无下游受影响</span>
                )}
              </div>
              {impact?.preserved.length ? <span className="sc-history-note">已交付版本保留：{impact.preserved.map((group) => `${group.kind} ${group.count}`).join("、")}</span> : null}
              {impact?.coverageGaps.length ? <span className="sc-history-note sc-history-note--warn">这次算不全：{impact.coverageGaps.join("；")}</span> : null}
            </article>
          );
        }) : <EmptyState>这个项目还没有写入记录。每一次写入都会留在这里，含时间、操作人、改了什么和为什么。</EmptyState>}
      </section>
    </ProjectPageFrame>
  );
}
