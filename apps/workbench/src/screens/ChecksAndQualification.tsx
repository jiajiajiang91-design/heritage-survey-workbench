import { useState } from "react";
import type { ArtifactRecord, CheckRun, ReviewSignoff } from "@gujian/domain";

import { QUALIFICATION_LIMITS, checkItemLabel, describeBlocker } from "../qualification";
import { Button, EmptyState, Tag } from "../ui";
import { FileViewer } from "../ui/FileViewer";
import { describePreview, previewLabel, type DrawingPreview, type PreviewRequirements } from "../workbench/useAssetUrls";
import "./ChecksAndQualification.css";

// W09 检查与签发（66:2949）：左卡正式图（头 36 加状态标签、图 480、题注 12/20、底部操作），
// 右卡检查结果（头 36 加不通过计数、检查小卡 10 内边距）。W09A 使用限制（66:3016）
// 是同一屏的展开态：限制逐条列出（qualification.ts 的 QUALIFICATION_LIMITS）。
export interface ChecksAndQualificationProps {
  previews: readonly DrawingPreview[];
  drawingArtifacts: readonly ArtifactRecord[];
  latestCheckRun: CheckRun | null;
  unknownCount: number;
  currentArtifactCount: number;
  crossRevisionArtifactCount: number;
  qualificationLabel: string | null;
  // 正式环境的复核签发记录；有它时成果按已签发显示（实施单元 09）
  signoff: ReviewSignoff | null;
  blockerReasons: readonly string[];
  blockerCodes: readonly string[];
  generating: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onDownload: (artifact: ArtifactRecord) => void;
  requirements: PreviewRequirements | null;
}

function blockerSummary(codes: readonly string[]): string {
  if (!codes.length) return "没有不通过的项";
  const counts = { qualification: 0, unknown: 0, issue: 0, check: 0, other: 0 };
  for (const code of codes) {
    if (code.startsWith("UNKNOWN:")) counts.unknown += 1;
    else if (code.startsWith("OPEN_ISSUE:")) counts.issue += 1;
    else if (code.startsWith("CHECK")) counts.check += 1;
    else if (QUALIFICATION_LIMITS.some((limit) => limit.code === code)) counts.qualification += 1;
    else counts.other += 1;
  }
  const parts = [
    counts.qualification && `${counts.qualification} 条签发前的限制`,
    counts.unknown && `${counts.unknown} 处未确认部位`,
    counts.issue && `${counts.issue} 条未处理事项`,
    counts.check && `${counts.check} 条检查不通过`,
    counts.other && `${counts.other} 条其他不通过`,
  ].filter(Boolean);
  return `${codes.length} 项不通过：${parts.join("、")}`;
}

export function ChecksAndQualification({ previews, drawingArtifacts, latestCheckRun, unknownCount, currentArtifactCount, crossRevisionArtifactCount, qualificationLabel, blockerReasons, blockerCodes, generating, canRegenerate, onRegenerate, onDownload, requirements, signoff }: ChecksAndQualificationProps) {
  const [showLimits, setShowLimits] = useState(false);
  const [index, setIndex] = useState(0);
  const preview = previews[Math.min(index, Math.max(0, previews.length - 1))] ?? null;
  // 签发后，检查里"需专业复核"一类的结果由签发记录解除，按通过显示
  const FORMAL_CODES = new Set(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", "L1_ELIGIBILITY_FALSE"]);
  const passedBySignoff = (code: string) => Boolean(signoff) && FORMAL_CODES.has(code) && (code !== "L1_ELIGIBILITY_FALSE" || signoff!.l1Eligible);
  const blocked = latestCheckRun?.results.filter((item) => item.outcome !== "passed" && !passedBySignoff(item.code)).length ?? 0;
  const exportables = drawingArtifacts.filter((artifact) => artifact.kind === "dxf" || artifact.kind === "pdf");
  const described = describePreview(preview, requirements);
  return (
    <div className="sc-checks">
      <section className="sc-checks-drawing">
        <div className="sc-checks-head">
          <span className="gj-pane-title" title={described.title}>{preview ? described.title : "图纸成果"}</span>
          <span className="gj-spacer" />
          {latestCheckRun && (signoff ? <Tag tone="success">已签发</Tag> : <Tag tone="warning">已生成，待签发</Tag>)}
        </div>
        {preview ? (
          preview.kind === "svg"
            ? <div className="sc-checks-figure"><img src={preview.url} alt={`${preview.label} 图面`} /></div>
            : <FileViewer blob={preview.url} mimeType="application/pdf" fileName={preview.label} height={480} />
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
          <span className="gj-pane-title">检查结果</span>
          <span className="gj-spacer" />
          <Tag tone={blocked ? "danger" : latestCheckRun ? "success" : "neutral"}>{latestCheckRun ? (blocked ? `${blocked} 项不通过` : "全部通过") : "未检查"}</Tag>
        </div>
        {latestCheckRun ? latestCheckRun.results.map((result) => (
          <div className="sc-check" key={result.code}>
            <div className="sc-check-head">
              <span>{checkItemLabel(result.code)}</span>
              <Tag tone={result.outcome === "passed" || passedBySignoff(result.code) ? "success" : "danger"}>{result.outcome === "passed" ? "通过" : passedBySignoff(result.code) ? "已复核" : "不通过"}</Tag>
            </div>
            <p>{passedBySignoff(result.code) ? `已由${signoff!.reviewerRole === "projectLead" ? "项目负责人" : "专业复核人"}于 ${signoff!.signedAt.slice(0, 10)} 复核签发。` : result.message}</p>
          </div>
        )) : <EmptyState>还没有检查结果。出图后自动检查；检查通过不等于复核通过，签发由项目责任人员完成。</EmptyState>}
        <div className="sc-check">
          <div className="sc-check-head"><span>成果状态</span>{signoff ? <Tag tone="success">已签发</Tag> : <Tag tone="warning">{latestCheckRun ? "已生成，待签发" : "未生成"}</Tag>}</div>
          <p>{signoff
            ? `${signoff.reviewerRole === "projectLead" ? "项目负责人" : "专业复核人"}于 ${signoff.signedAt.slice(0, 10)} 复核签发，可正式交付。${signoff.statementZh}`
            : qualificationLabel ? `${qualificationLabel}。签发前只能作为待签发成果使用，不能正式交付` : "出图并检查后显示成果状态"}{crossRevisionArtifactCount ? `；另有 ${crossRevisionArtifactCount} 项旧版本成果已隔离` : ""}{signoff ? "" : `。当前成果 ${currentArtifactCount} 项，模型待确认部位 ${unknownCount} 处。`}</p>
        </div>
        <div className="sc-check">
          <div className="sc-check-head"><span>成果等级</span>{signoff?.l1Eligible ? <Tag tone="success">专业样板</Tag> : <Tag>{signoff ? "一般成果" : "待评定"}</Tag>}</div>
          <p>{signoff?.l1Eligible
            ? "复核认定达到专业样板等级，可作为同类项目的参照"
            : signoff
              ? "本项目成果不作为其他项目的参照标准；不影响本项目的正式交付"
              : "等级由复核签发时评定；签发前不作为专业样板或参照标准使用"}</p>
        </div>
        <div className="sc-check">
          <div className="sc-check-head"><span>能否正式交付</span><Tag tone={blockerCodes.length ? "danger" : "success"}>{blockerCodes.length ? "还不能" : signoff ? "可以" : "签发后可以"}</Tag></div>
          <p>{blockerCodes.length === 0 && signoff ? `已由${signoff.reviewerRole === "projectLead" ? "项目负责人" : "专业复核人"}复核签发，可以正式交付。` : blockerSummary(blockerCodes)}</p>
          {showLimits && blockerReasons.length > 0 && (
            <ul className="sc-check-reasons">{blockerReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          )}
        </div>
        {showLimits && (() => {
          const limits = QUALIFICATION_LIMITS.filter((limit) => !signoff || (limit.code === "L1_ELIGIBILITY_FALSE" && !signoff.l1Eligible));
          return (
            <div className="sc-check sc-check--limits">
              <div className="sc-check-head"><span>使用限制</span><Tag tone={limits.length ? "warning" : "success"}>{signoff ? (limits.length ? `签发后仍适用 ${limits.length} 条` : "无") : `${limits.length} 条`}</Tag></div>
              {limits.map((limit) => (
                <div className="sc-check-limit" key={limit.code}>
                  <strong>{limit.layerZh}</strong>
                  <p>{limit.textZh}</p>
                </div>
              ))}
              {!limits.length && <p>复核签发后没有仍然适用的使用限制。</p>}
              <p>{signoff ? "图签上的签发状态以签发记录为准。" : "图签同样印有待签发状态，日期栏印的也是未签发。"}</p>
            </div>
          );
        })()}
        <span className="gj-spacer" />
        <div className="gj-actions">
          <Button onClick={() => setShowLimits((value) => !value)} aria-expanded={showLimits}>{showLimits ? "收起使用限制" : "查看使用限制"}</Button>
          {signoff
            ? <Button variant="primary" disabled title="已签发，复核记录随项目包导入">已复核签发</Button>
            : <Button variant="primary" disabled title="本机身份不具备签发资格，签发须由项目责任人员在正式环境完成">提交复核</Button>}
        </div>
      </section>
    </div>
  );
}
