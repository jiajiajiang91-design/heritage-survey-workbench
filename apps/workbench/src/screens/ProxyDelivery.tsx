import { useState } from "react";
import type { ArtifactRecord, CheckRun, DeliveryDraft, DeliveryEvaluation } from "@gujian/domain";

import { ARTIFACT_KIND_LABELS, RESPONSIBILITY_ROLE_LABELS } from "../labels";
import { LongTask } from "../LongTask";
import { Button, EmptyState, Tag } from "../ui";
import type { RoundTripReceipt } from "../workbench/useRecordWrites";
import "./ProxyDelivery.css";

// W10 代理交付（66:3116）：左卡交付清单（文件卡 76 高：文件名、资格标签、类型 · 体积），
// 右卡交付草案（签名标签、八行 13/26 摘要、阻断项卡、导出与限制条款操作）。
// 交付包含成果、检查记录、来源说明与限制条件（PRD F16）；L1=false，未签发要明说。
export interface ProxyDeliveryProps {
  projectName: string;
  buildingName: string;
  responsibilityRoles: readonly string[];
  artifacts: readonly ArtifactRecord[];
  checkRuns: readonly CheckRun[];
  latestCheckRun: CheckRun | null;
  latestDelivery: DeliveryDraft | null;
  latestBlockedDelivery: DeliveryEvaluation | null;
  deliveryBlockers: readonly string[];
  blockerCodes: readonly string[];
  canCreate: boolean;
  exporting: boolean;
  showExportTask: boolean;
  exportPhase: string | null;
  exportCancelling: boolean;
  roundTripReceipt: RoundTripReceipt | null;
  onCreate: () => void;
  onRecordBlocked: () => void;
  onExport: (type: "json" | "zip") => void;
  onCancelExport: () => void;
  onVerifyRoundTrip: () => void;
  onDownload: (artifact: ArtifactRecord) => void;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ProxyDelivery(props: ProxyDeliveryProps) {
  const { projectName, buildingName, responsibilityRoles, artifacts, checkRuns, latestCheckRun, latestDelivery, latestBlockedDelivery, deliveryBlockers, blockerCodes, canCreate, exporting, showExportTask, exportPhase, exportCancelling, roundTripReceipt, onCreate, onRecordBlocked, onExport, onCancelExport, onVerifyRoundTrip, onDownload } = props;
  const [showRestrictions, setShowRestrictions] = useState(false);
  const delivered = latestDelivery ? artifacts.filter((artifact) => latestDelivery.artifactRefs.includes(artifact.id)) : artifacts;
  const kinds = new Set(delivered.map((artifact) => artifact.kind));
  const checkResults = checkRuns.reduce((sum, run) => sum + run.results.length, 0);
  const roles = responsibilityRoles.map((role) => RESPONSIBILITY_ROLE_LABELS[role] ?? role);
  const summary: [string, string][] = [
    ["项目", projectName],
    ["对象", buildingName],
    ["成果", `${delivered.length} 项，${kinds.size} 种`],
    ["检查", `${checkRuns.length} 次，${checkResults} 条结果`],
    ["评估结果", latestDelivery ? "可出代理成果" : deliveryBlockers.length ? "暂不能正式交付" : "尚未评估"],
    ["签名状态", latestDelivery ? "未签名" : "尚无草案"],
    ["限制条款", latestDelivery ? `${latestDelivery.restrictions.length} 条` : "尚无"],
    ["责任人", roles.length ? roles.join("、") : "未登记"],
  ];

  return (
    <div className="sc-delivery">
      <section className="sc-delivery-manifest">
        <div className="gj-pane-head">
          <span className="gj-pane-title">交付清单</span>
          <Tag>{delivered.length} 项成果</Tag>
        </div>
        {delivered.length ? (
          <div className="gj-pane-list">
            {delivered.map((artifact) => (
              <button type="button" className="sc-delivery-file" key={artifact.id} onClick={() => onDownload(artifact)} title="下载这份成果">
                <div className="sc-delivery-file-head">
                  <span>{artifact.fileName}</span>
                  <Tag tone="warning">未获资格</Tag>
                </div>
                <small>{ARTIFACT_KIND_LABELS[artifact.kind] ?? artifact.kind} · {sizeLabel(artifact.byteLength)}</small>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState>还没有可交付的成果。生成三维模型与成组图纸并通过检查后，成果会列在这里。</EmptyState>
        )}
      </section>
      <section className="sc-delivery-summary">
        <span className="gj-pane-title">交付草案</span>
        <div className="gj-row">
          <Tag tone="warning">{latestDelivery ? "未签名" : "尚无草案"}</Tag>
        </div>
        <ul className="sc-delivery-lines">
          {summary.map(([label, value]) => <li key={label}>{label}：{value}</li>)}
        </ul>
        <div className="gj-card gj-card--compact sc-delivery-blockers">
          <span className="gj-text-label">{blockerCodes.length ? `${blockerCodes.length} 条阻断项` : "没有阻断项"}</span>
          <p>{blockerCodes.length ? `${deliveryBlockers.slice(0, 3).join("；")}${deliveryBlockers.length > 3 ? "；等" : ""}。${latestDelivery ? "都只阻断正式资格，不阻断代理成果。" : ""}` : "可以建立代理交付草案。"}</p>
          {!latestDelivery && deliveryBlockers.length > 0 && (
            <Button compact disabled={Boolean(latestBlockedDelivery)} onClick={onRecordBlocked}>{latestBlockedDelivery ? "已记录原因" : "记录无法交付的原因"}</Button>
          )}
        </div>
        {showRestrictions && latestDelivery && (
          <div className="gj-card gj-card--compact">
            <span className="gj-text-label">限制条款 {latestDelivery.restrictions.length} 条</span>
            <ol className="sc-delivery-restrictions">{latestDelivery.restrictions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>
          </div>
        )}
        {showExportTask && <LongTask labelZh={`正在导出项目包：${exportPhase ?? ""}`} onCancel={onCancelExport} cancelling={exportCancelling} />}
        {roundTripReceipt && (
          <div className="gj-card gj-card--compact">
            <span className="gj-text-label">导出与恢复检验通过</span>
            <dl className="sc-delivery-receipt" aria-label="恢复检验结果">
              <div><dt>资料</dt><dd>{roundTripReceipt.evidenceCount}</dd></div>
              <div><dt>规则</dt><dd>{roundTripReceipt.ruleRunCount}</dd></div>
              <div><dt>人工决定</dt><dd>{roundTripReceipt.decisionCount}</dd></div>
              <div><dt>几何版本</dt><dd>{roundTripReceipt.geometryRevisionCount}</dd></div>
              <div><dt>成果</dt><dd>{roundTripReceipt.artifactCount}</dd></div>
              <div><dt>检查</dt><dd>{roundTripReceipt.checkRunCount}</dd></div>
              <div><dt>交付</dt><dd>{roundTripReceipt.deliveryCount}</dd></div>
              <div><dt>项目记录</dt><dd>{roundTripReceipt.jsonEvidenceCount} 份资料，原文件另存于 ZIP 包</dd></div>
            </dl>
          </div>
        )}
        {/* 操作按 v4（66:3123）右对齐、主操作在前；四个按钮在 276 宽的卡里折成两行。导出进度由下方长任务条显示，按钮不再带加载槽 */}
        <div className="gj-actions">
          {!latestDelivery && <Button variant="primary" disabled={!canCreate} onClick={onCreate}>建立代理交付草案</Button>}
          {latestDelivery && <Button variant="primary" disabled={exporting} onClick={() => onExport("zip")}>导出代理 ZIP</Button>}
          {latestDelivery && <Button onClick={() => setShowRestrictions((value) => !value)} aria-expanded={showRestrictions}>{showRestrictions ? "收起限制条款" : "查看限制条款"}</Button>}
          <Button disabled={exporting} onClick={() => onExport("json")}>导出 JSON</Button>
          <Button onClick={onVerifyRoundTrip}>检验导出与恢复</Button>
        </div>
        <p className="gj-note">导出后可在一个独立环境里恢复并逐项核对资料、记录与成果。检验不改动本机项目，结束后自动清理。{latestCheckRun ? "" : " 尚未检查的成果不进交付草案。"}</p>
      </section>
    </div>
  );
}
