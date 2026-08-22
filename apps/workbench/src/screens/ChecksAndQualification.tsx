import { useState } from "react";
import type { ArtifactRecord, ArtifactRequirementMatrix, CheckRun } from "@gujian/domain";

import { QUALIFICATION_LIMITS, describeBlocker } from "../qualification";
import { Button, EmptyState, Tag } from "../ui";
import { describePreview, previewLabel, type DrawingPreview } from "../workbench/useAssetUrls";
import "./ChecksAndQualification.css";

// W09 检查与资格（66:2949）：左卡正式图（头 36 加状态标签、图 480、题注 12/20、底部操作），
// 右卡检查结果与资格（头 36 加阻断计数、检查小卡 10 内边距）。W09A 资格与限制（66:3016）
// 是同一屏的展开态：三层限制逐条列出（qualification.ts 的 QUALIFICATION_LIMITS）。
export interface ChecksAndQualificationProps {
  previews: readonly DrawingPreview[];
  drawingArtifacts: readonly ArtifactRecord[];
  latestCheckRun: CheckRun | null;
  unknownCount: number;
  currentArtifactCount: number;
  crossRevisionArtifactCount: number;
  qualificationLabel: string | null;
  blockerReasons: readonly string[];
  blockerCodes: readonly string[];
  generating: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onDownload: (artifact: ArtifactRecord) => void;
  requirements: ArtifactRequirementMatrix | null;
}

function blockerSummary(codes: readonly string[]): string {
  if (!codes.length) return "没有阻断项";
  const counts = { qualification: 0, unknown: 0, issue: 0, check: 0, other: 0 };
  for (const code of codes) {
    if (code.startsWith("UNKNOWN:")) counts.unknown += 1;
    else if (code.startsWith("OPEN_ISSUE:")) counts.issue += 1;
    else if (code.startsWith("CHECK")) counts.check += 1;
    else if (QUALIFICATION_LIMITS.some((limit) => limit.code === code)) counts.qualification += 1;
    else counts.other += 1;
  }
  const parts = [
    counts.qualification && `${counts.qualification} 条资格限制`,
    counts.unknown && `${counts.unknown} 处未确认部位`,
    counts.issue && `${counts.issue} 条未处理事项`,
    counts.check && `${counts.check} 条检查不通过`,
    counts.other && `${counts.other} 条其他阻断`,
  ].filter(Boolean);
  return `${codes.length} 条阻断项：${parts.join("、")}`;
}

export function ChecksAndQualification({ previews, drawingArtifacts, latestCheckRun, unknownCount, currentArtifactCount, crossRevisionArtifactCount, qualificationLabel, blockerReasons, blockerCodes, generating, canRegenerate, onRegenerate, onDownload, requirements }: ChecksAndQualificationProps) {
  const [showLimits, setShowLimits] = useState(false);
  const [index, setIndex] = useState(0);
  const preview = previews[Math.min(index, Math.max(0, previews.length - 1))] ?? null;
  const blocked = latestCheckRun?.results.filter((item) => item.outcome !== "passed").length ?? 0;
  const exportables = drawingArtifacts.filter((artifact) => artifact.kind === "dxf" || artifact.kind === "pdf");
  const described = describePreview(preview, requirements);
  return (
    <div className="sc-checks">
      <section className="sc-checks-drawing">
        <div className="sc-checks-head">
          <span className="gj-pane-title" title={described.title}>{preview ? described.title : "图纸成果"}</span>
          <span className="gj-spacer" />
          {latestCheckRun && <Tag tone="warning">已生成未获资格</Tag>}
        </div>
        {preview ? (
          preview.kind === "svg"
            ? <div className="sc-checks-figure"><img src={preview.url} alt={`${preview.label} 图面`} /></div>
            : <object className="sc-checks-figure" data={preview.url} type="application/pdf" aria-label={`${preview.label} 图面`} />
        ) : (
          <div className="sc-checks-figure sc-checks-figure--empty">{latestCheckRun ? "本次检查没有可预览的图面。" : "还没有检查记录。出图后自动检查，检查通过不等于专业复核通过。"}</div>
        )}
        {previews.length > 1 && (
          <div className="sc-checks-switch" role="tablist" aria-label="切换图面">
            {previews.map((item, position) => (
              <button key={item.id} type="button" role="tab" aria-current={position === index ? "true" : undefined} onClick={() => setIndex(position)}>{previewLabel(item)}</button>
            ))}
          </div>
        )}
        {described.caption && <p className="sc-checks-caption">{described.caption}</p>}
        <span className="gj-spacer" />
        <div className="gj-actions">
          <Button disabled={!exportables.length} onClick={() => exportables.forEach((artifact) => onDownload(artifact))}>导出 DXF 与 PDF</Button>
          <Button variant="primary" loadable busy={generating} disabled={!canRegenerate} onClick={onRegenerate}>重新出图并检查</Button>
        </div>
      </section>
      <section className="sc-checks-results">
        <div className="sc-checks-head sc-checks-head--tight">
          <span className="gj-pane-title">检查结果与资格</span>
          <span className="gj-spacer" />
          <Tag tone={blocked ? "danger" : latestCheckRun ? "success" : "neutral"}>{latestCheckRun ? (blocked ? `${blocked} 项阻断` : "全部通过") : "未检查"}</Tag>
        </div>
        {latestCheckRun ? latestCheckRun.results.map((result) => (
          <div className="sc-check" key={result.code}>
            <div className="sc-check-head">
              <span>{describeBlocker(result.code)}</span>
              <Tag tone={result.outcome === "passed" ? "success" : "danger"}>{result.outcome === "passed" ? "通过" : "阻断"}</Tag>
            </div>
            <p>{result.message}</p>
          </div>
        )) : <EmptyState>还没有检查记录。检查通过不等于专业复核通过，签发仍需责任人操作。</EmptyState>}
        <div className="sc-check">
          <div className="sc-check-head"><span>成果状态</span><Tag tone="warning">{latestCheckRun ? "已生成未获资格" : "未生成"}</Tag></div>
          <p>{qualificationLabel ? `${qualificationLabel}，只能作为代理成果，不能用于正式交付` : "出图并检查后显示资格状态"}{crossRevisionArtifactCount ? `；另有 ${crossRevisionArtifactCount} 项旧版本成果已隔离` : ""}。当前成果 {currentArtifactCount} 项，模型待确认项 {unknownCount} 处。</p>
        </div>
        <div className="sc-check">
          <div className="sc-check-head"><span>成果等级</span><Tag>未达专业样板等级</Tag></div>
          <p>不作为专业样板或参照标准使用</p>
        </div>
        <div className="sc-check">
          <div className="sc-check-head"><span>正式交付资格</span><Tag tone={blockerCodes.length ? "danger" : "success"}>{blockerCodes.length ? "阻断" : "无阻断"}</Tag></div>
          <p>{blockerSummary(blockerCodes)}</p>
          {showLimits && blockerReasons.length > 0 && (
            <ul className="sc-check-reasons">{blockerReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          )}
        </div>
        {showLimits && (
          <div className="sc-check sc-check--limits">
            <div className="sc-check-head"><span>资格与使用限制</span><Tag tone="warning">三层</Tag></div>
            {QUALIFICATION_LIMITS.map((limit) => (
              <div className="sc-check-limit" key={limit.code}>
                <strong>{limit.layerZh}</strong>
                <p>{limit.textZh}</p>
              </div>
            ))}
            <p>图签同样印有代理成果与未签发状态，日期栏印的也是未签发。</p>
          </div>
        )}
        <span className="gj-spacer" />
        <div className="gj-actions">
          <Button onClick={() => setShowLimits((value) => !value)} aria-expanded={showLimits}>{showLimits ? "收起资格限制" : "查看资格限制"}</Button>
          <Button variant="primary" disabled title="本机身份不具备签发资格，签发须由项目责任人员在正式环境完成">提交专业复核</Button>
        </div>
      </section>
    </div>
  );
}
