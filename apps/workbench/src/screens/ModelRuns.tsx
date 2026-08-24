import type { ProjectHead } from "@gujian/application";
import type { ModelRun } from "@gujian/domain";

import { REVIEW_LABELS } from "../labels";
import { formatCost } from "../model-pricing";
import type { ModelRunCostView } from "../query-models";
import { ProjectPageFrame } from "../shell/AppShell";
import { Alert, Button, EmptyState, Metric, SourceTag, Tag } from "../ui";
import "./ModelRuns.css";

// P02 模型运行与用量（66:3172）：三张指标卡（真实调用、累计用量、费用合计）、运行表（表头 40、行 56，
// 五列运行内容/发起时间/耗时/用量与费用/结果）、识别候选区。费用按用量与公开单价算得（PRD 附录 A.4）。
type Candidate = ProjectHead["snapshot"]["candidates"][number];

export interface ModelRunsProps {
  runs: readonly ModelRun[];
  costView: ModelRunCostView;
  // 服务器侧今日的助手调用数（对话与建议不在项目里留运行记录，靠它对账）
  assistantUsage: { day: string; totals: { assistant: number; suggest: number; jobs: number } } | null;
  candidates: readonly Candidate[];
  exclusionCount: number;
  serverModel: string | null;
  modelConfigured: boolean;
  canRun: boolean;
  running: boolean;
  hasReadableDrawings: boolean;
  evidenceTitle: (ref: string) => string;
  onRun: () => void;
  onRefreshStatus: () => void;
  onConfirmComponents: (candidate: Candidate) => void;
  onConfirmDimensions: (candidate: Candidate) => void;
  back: { label: string; onBack: () => void };
}

const TASK_ZH: Record<string, string> = {
  "evidence-summary": "资料要点整理", "measurement-transcription": "图纸尺寸转写", "component-recognition": "构件识别",
};
const STATUS_ZH: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  succeeded: { label: "完成", tone: "success" }, failed: { label: "失败", tone: "danger" }, cancelled: { label: "已取消", tone: "neutral" },
};

function durationLabel(run: ModelRun): string {
  const seconds = Math.max(0, Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000));
  const attempts = Math.max(...run.events.map((event) => event.attempt), 1);
  return attempts > 1 ? `重试后 ${seconds} 秒` : `${seconds} 秒`;
}

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function tokenLabel(total: number): string {
  return total >= 10_000 ? `约 ${(total / 10_000).toFixed(1)} 万 token` : `${total} token`;
}

export function ModelRuns({ runs, costView, assistantUsage, candidates, exclusionCount, serverModel, modelConfigured, canRun, running, hasReadableDrawings, evidenceTitle, onRun, onRefreshStatus, onConfirmComponents, onConfirmDimensions, back }: ModelRunsProps) {
  const byTask = new Map<string, number>();
  for (const run of runs) byTask.set(run.taskType, (byTask.get(run.taskType) ?? 0) + 1);
  const priced = costView.rows.filter((row) => row.cost).length;
  const recognitionTokens = runs.filter((run) => run.taskType === "component-recognition").reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0);
  return (
    <ProjectPageFrame
      title="模型运行与用量"
      description={`${assistantUsage ? `今天服务器上的助手调用：对话 ${assistantUsage.totals.assistant} 次、建议 ${assistantUsage.totals.suggest} 次、生成作业 ${assistantUsage.totals.jobs} 次（点右上角刷新状态更新）。` : ""}下表只列项目内的识别与转写运行，助手的对话和建议不进项目记录。${costView.priceSourcesZh.length ? `费用按用量与公开单价算得，单价取自${costView.priceSourcesZh.join("；")}，缓存命中的输入单独计价。` : "单价表里没有本次用到的模型时如实写明暂无法计算。"}${serverModel ? `当前使用的模型是 ${serverModel}。` : ""}`}
      actions={<Button onClick={onRefreshStatus}>刷新状态</Button>}
      back={back}
    >
      {!modelConfigured && <Alert tone="warning">服务端尚未配置模型密钥，真实运行按钮已锁定。配置 KIMI_API_KEY 后刷新状态。</Alert>}
      <div className="sc-runs-metrics">
        <Metric label="真实调用" value={`${runs.length} 次`} note={[...byTask.entries()].map(([task, count]) => `${TASK_ZH[task] ?? task} ${count} 次`).join(" · ") || "尚未运行"} />
        <Metric label="累计用量" value={tokenLabel(costView.totalTokens)} note={recognitionTokens ? `其中构件识别 ${recognitionTokens} token` : "按服务端返回的用量累计"} />
        <Metric label="费用合计" value={costView.totalCost ? formatCost(costView.totalCost) : "暂无法计算"} note={costView.totalCost ? `表内 ${priced} 次算得${priced < runs.length ? `，其余 ${runs.length - priced} 次未留用量或无单价` : ""}` : "没有可计价的运行"} />
      </div>
      <section className="sc-runs-table">
        <div className="sc-runs-head"><span>运行内容</span><span>发起时间</span><span>耗时</span><span>用量与费用</span><span>结果</span></div>
        {/* 助手对话与建议不留项目内运行记录，这里只列识别与转写。表头下说明一句，免得用户拿对话次数来对账 */}
        {runs.length ? [...runs].reverse().map((run) => {
          const row = costView.rows.find((item) => item.runId === run.id);
          const status = STATUS_ZH[run.status] ?? { label: run.status, tone: "neutral" as const };
          return (
            <div className="sc-runs-row" key={run.id}>
              <span className="sc-runs-name">{TASK_ZH[run.taskType] ?? run.taskType}{run.evidenceRefs.length > 1 ? `（${run.evidenceRefs.length} 份资料）` : ""}<small>{run.provider} / {run.model}</small></span>
              <span className="sc-runs-time">{dateLabel(run.startedAt)}</span>
              <span>{durationLabel(run)}</span>
              <span>{row?.totalTokens != null ? `${row.totalTokens} token · ${row.costLabel}` : row?.costLabel ?? "未记录用量"}</span>
              <span><Tag tone={status.tone}>{(row?.attempts ?? 1) > 1 && run.status === "succeeded" ? "重试后完成" : status.label}</Tag></span>
            </div>
          );
        }) : <EmptyState>还没有真实调用。识别与转写在资料清单发起，结果回到这里的待确认区。</EmptyState>}
        {runs.length > 0 && <p className="gj-note">费用按用量与公开单价算得，仅供参考，以服务商账单为准。</p>}
      </section>
      <section className="sc-runs-candidates">
        <span className="gj-pane-title">识别候选 · {candidates.length} 条</span>
        <p className="gj-pane-desc">助手的识别结果只进入待确认区，需要人工确认后才写入项目。{candidates.length ? "" : `当前没有待确认的候选。`}排除记录 {exclusionCount} 条{exclusionCount ? "" : "，没有构件被排除过"}。</p>
        {candidates.map((candidate) => (
          <article className="sc-runs-candidate" key={candidate.id}>
            <div className="gj-row"><SourceTag producerType="model" /><Tag>{REVIEW_LABELS[candidate.reviewStatus] ?? candidate.reviewStatus}</Tag></div>
            <strong>{candidate.structured?.summary ?? "模型返回的原文（未按固定格式整理，内容如下，由你判断是否采用）"}</strong>
            {/* 没整理成结构的回答也要给人看原文：只写一句"未结构化"等于让用户对着空气做接受或驳回的决定 */}
            {!candidate.structured && <p className="sc-runs-candidate-raw">{candidate.contentText.slice(0, 2_000)}{candidate.contentText.length > 2_000 ? "……（更长的部分略）" : ""}</p>}
            {candidate.structured?.kind === "evidenceSummary" && candidate.structured.findings.length > 0 && (
              <ul>{candidate.structured.findings.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
            {candidate.structured?.kind === "measurementTranscription" && (["certain", "uncertain"] as const).map((certainty) => {
              const rows = candidate.structured?.kind === "measurementTranscription" ? candidate.structured.dimensions.filter((item) => item.certainty === certainty) : [];
              return rows.length ? (
                <div key={certainty}>
                  <span className="gj-text-label">{certainty === "certain" ? `读出的尺寸 ${rows.length} 条` : `需要你确认的 ${rows.length} 条`}</span>
                  <ul>{rows.map((row) => <li key={`${row.evidenceRef}:${row.valueText}:${row.locationZh ?? ""}`}>{row.partZh ?? "部位待确认"} {row.valueText}{row.valueMm ? `（${row.valueMm} mm）` : ""} · {evidenceTitle(row.evidenceRef)}{row.locationZh ? ` · ${row.locationZh}` : ""}{row.noteZh ? ` · ${row.noteZh}` : ""}</li>)}</ul>
                </div>
              ) : null;
            })}
            {candidate.structured?.kind === "componentRecognition" && (["certain", "uncertain"] as const).map((certainty) => {
              const rows = candidate.structured?.kind === "componentRecognition" ? candidate.structured.components.filter((item) => item.certainty === certainty) : [];
              return rows.length ? (
                <div key={certainty}>
                  <span className="gj-text-label">{certainty === "certain" ? `认出的构件 ${rows.length} 个` : `需要你核实的 ${rows.length} 个`}</span>
                  <ul>{rows.map((row, index) => <li key={`${row.evidenceRef}:${row.nameZh}:${index}`}>{row.nameZh}{row.categoryZh ? ` · ${row.categoryZh}` : " · 类别待确认"} · {evidenceTitle(row.evidenceRef)} 上 {(row.region.x * 100).toFixed(1)}%、{(row.region.y * 100).toFixed(1)}% 起，宽 {(row.region.width * 100).toFixed(1)}%、高 {(row.region.height * 100).toFixed(1)}%{row.noteZh ? ` · ${row.noteZh}` : ""}</li>)}</ul>
                </div>
              ) : null;
            })}
            {!!candidate.structured?.missingInformation.length && <div><span className="gj-text-label">缺失信息</span><ul>{candidate.structured.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {candidate.reviewStatus === "unreviewed" && candidate.structured?.kind === "componentRecognition" && (
              <div className="gj-actions gj-actions--start"><Button variant="primary" compact onClick={() => onConfirmComponents(candidate)}>确认认出的构件并写入项目</Button></div>
            )}
            {candidate.reviewStatus === "unreviewed" && candidate.structured?.kind === "measurementTranscription" && (
              <div className="gj-actions gj-actions--start"><Button variant="primary" compact onClick={() => onConfirmDimensions(candidate)}>确认读准的尺寸并写入项目</Button></div>
            )}
          </article>
        ))}
        {/* v4（66:3172）标题行只有刷新状态；发起识别是待确认区的动作，放在候选卡底部 */}
        <div className="gj-actions">
          <Button variant="primary" loadable busy={running} disabled={!canRun} onClick={onRun}>{hasReadableDrawings ? "识别构件" : "整理资料要点"}</Button>
        </div>
      </section>
    </ProjectPageFrame>
  );
}
