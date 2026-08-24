import { useState } from "react";

import { DATA_STATUS_LABELS, PARSE_STATUS_LABELS } from "../labels";
import { Button, Tag } from "../ui";
import "./Dialogs.css";

// B02 资料缺失（66:3950）：700 宽对话框，两张对照卡（已登记 / 实际可用）、三条处置选项（56 高单选行）、底部操作。
// 产品对缺失资料的三种记法：记为缺资料进问题队列、补入资料后重新核对、只登记不解析（核心 PRD F02）。
export interface MissingEvidenceItem {
  id: string;
  title: string;
  dataStatus: string;
  parseStatus: string | null;
}

type Choice = "issue" | "reupload" | "register";

export function EvidenceMissingDialog({ registered, onClose, onGoToIssues, onUpload }: {
  registered: readonly MissingEvidenceItem[];
  onClose: () => void;
  onGoToIssues: () => void;
  onUpload: () => void;
}) {
  const [choice, setChoice] = useState<Choice>("issue");
  const missing = registered.filter((item) => item.dataStatus !== "available");
  const choices: { key: Choice; title: string; note: string }[] = [
    { key: "issue", title: "继续，记为缺资料", note: "按缺资料写入问题队列，成果只能作为待签发成果，不能作为测绘成果" },
    { key: "reupload", title: "补入资料后重新核对", note: "资料补入后须重新核对识别结果，已有结论不自动沿用" },
    { key: "register", title: "只登记不解析", note: "记为仅登记未读取内容，不产生任何推断" },
  ];
  const confirm = () => {
    if (choice === "reupload") onUpload();
    else if (choice === "issue") onGoToIssues();
    onClose();
  };
  return (
    <div className="gj-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sc-dialog sc-dialog--700" role="dialog" aria-modal="true" aria-labelledby="sc-missing-title">
        <h2 className="sc-dialog-title" id="sc-missing-title">{missing.length === 1 ? `${missing[0]!.title}缺失` : `${missing.length} 份资料缺失`}</h2>
        <p className="sc-dialog-note">项目里登记了这些资料，但文件不存在。依赖它们的尺寸没有实测来源，由其他资料转写或形制推算。</p>
        <div className="sc-dialog-compare">
          <div className="sc-dialog-compare-card is-selected">
            <strong>已登记</strong>
            {registered.map((item) => <span key={item.id}>{item.title}</span>)}
          </div>
          <div className="sc-dialog-compare-card">
            <strong>实际可用</strong>
            {registered.map((item) => (
              <span key={item.id}>{item.dataStatus === "available" ? (item.parseStatus ? PARSE_STATUS_LABELS[item.parseStatus] ?? item.parseStatus : "可用") : DATA_STATUS_LABELS[item.dataStatus] ?? item.dataStatus}</span>
            ))}
          </div>
        </div>
        {choices.map((item) => (
          <label className={`sc-dialog-choice${choice === item.key ? " is-selected" : ""}`} key={item.key}>
            <input type="radio" name="missing-choice" checked={choice === item.key} onChange={() => setChoice(item.key)} />
            <span className="sc-dialog-choice-text">
              <strong>{item.title}</strong>
              <small>{item.note}</small>
            </span>
          </label>
        ))}
        <span className="gj-spacer" />
        <div className="gj-dialog-actions">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={confirm}>{choice === "issue" ? "记入问题队列" : choice === "reupload" ? "补入资料" : "只登记"}</Button>
        </div>
      </div>
    </div>
  );
}

// B03 识别未运行（66:3999）：工作区顶部的警示条，56 高，左侧感叹号、标题与说明、右侧次按钮。
export function FallbackBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="sc-fallback" role="status">
      <span className="sc-fallback-mark" aria-hidden="true">!</span>
      <div className="sc-fallback-text">
        <strong>模型服务没有配置访问凭证</strong>
        <span>识别不会运行。在本机服务的环境配置中填入凭证后重试，凭证不进入浏览器。</span>
      </div>
      <Button onClick={onDismiss}>查看已有构件</Button>
    </div>
  );
}

// B04 服务恢复（66:4121）：660 宽对话框，四行状态、恢复方式卡、底部操作。
// 连接中断时已写入的数据保持在中断前的状态，重试从当前版本重新执行。
export function ServiceRecoveryDialog({ hasDrawings, hasCheck, onViewLast, onRetry }: {
  hasDrawings: boolean;
  hasCheck: boolean;
  onViewLast: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="gj-scrim" role="presentation">
      <div className="sc-dialog sc-dialog--660" role="alertdialog" aria-modal="true" aria-labelledby="sc-recovery-title">
        <h2 className="sc-dialog-title" id="sc-recovery-title">与本机服务的连接中断</h2>
        <p className="sc-dialog-note sc-dialog-note--wide">进度不再更新，本次操作没有执行。已写入的数据保持在中断前的状态。</p>
        <div className="sc-dialog-status">
          <div><span>已生成的图纸成果</span><Tag tone={hasDrawings ? "success" : "neutral"}>{hasDrawings ? "已写入" : "尚无"}</Tag></div>
          <div><span>上次检查结果</span><Tag tone={hasCheck ? "accent" : "neutral"}>{hasCheck ? "可查看" : "尚无"}</Tag></div>
          <div><span>作业进度</span><Tag tone="warning">不再更新</Tag></div>
          <div><span>本次未提交的操作</span><Tag>未执行</Tag></div>
        </div>
        <div className="sc-dialog-recovery">
          <span>恢复方式</span>
          <p>确认本机服务已启动后重试。重试从当前版本重新执行，不覆盖已写入的记录。</p>
        </div>
        <span className="gj-spacer" />
        <div className="gj-dialog-actions">
          <Button onClick={onViewLast}>查看上次结果</Button>
          <Button variant="primary" onClick={onRetry}>重试</Button>
        </div>
      </div>
    </div>
  );
}
