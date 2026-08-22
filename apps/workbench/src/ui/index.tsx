import type { ButtonHTMLAttributes, ReactNode } from "react";

import { PRODUCER_LABELS } from "../labels";

// 基础组件（07 第 5 节）。只管形式，不碰数据：页面把真实数据填进来。
// 类名体系与 components.css 一一对应，由 visual-spec.test.ts 锁住。

type ButtonVariant = "primary" | "secondary" | "text" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  // 有加载态的按钮常驻指示器槽位，进入加载态时宽度不跳（07 第 5.1 节）
  loadable?: boolean;
  busy?: boolean;
  icon?: boolean;
  compact?: boolean;
}

export function Button({ variant = "secondary", loadable, busy, icon, compact, className, type = "button", children, ...rest }: ButtonProps) {
  const classes = ["gj-btn", `gj-btn--${variant}`, loadable && "gj-btn--loadable", icon && "gj-btn--icon", compact && "gj-btn--compact", className]
    .filter(Boolean).join(" ");
  return <button className={classes} type={type} aria-busy={busy || undefined} {...rest}>{children}</button>;
}

export type TagTone = "neutral" | "success" | "warning" | "danger" | "accent";

export function Tag({ tone = "neutral", children, title }: { tone?: TagTone; children: ReactNode; title?: string }) {
  return <span className={tone === "neutral" ? "gj-tag" : `gj-tag gj-tag--${tone}`} title={title}>{children}</span>;
}

// 来源标记：颜色加文字，一个标签一种含义。文字取 PRODUCER_LABELS，不另写。
export function SourceTag({ producerType, label }: { producerType: string; label?: string }) {
  return <span className={`gj-source gj-source--${producerType}`}>{label ?? PRODUCER_LABELS[producerType] ?? producerType}</span>;
}

// 数据状态标记：可用走中性，存疑走警示，缺失与过期走危险
export function DataStatusTag({ status, label }: { status: string; label: string }) {
  const tone: TagTone = status === "available" ? "success" : status === "uncertain" ? "warning" : "danger";
  return <Tag tone={tone}>{label}</Tag>;
}

export function Card({ children, className, compact, subtle }: { children: ReactNode; className?: string; compact?: boolean; subtle?: boolean }) {
  const classes = ["gj-card", compact && "gj-card--compact", subtle && "gj-card--subtle", className].filter(Boolean).join(" ");
  return <section className={classes}>{children}</section>;
}

export function Metric({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="gj-metric">
      <span className="gj-metric-label">{label}</span>
      <strong className="gj-metric-value">{value}</strong>
      {note !== undefined && <span className="gj-metric-note">{note}</span>}
    </div>
  );
}

export function InfoRow({ label, value, trailing }: { label: ReactNode; value: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="gj-info-row">
      <div>
        <span className="gj-info-row-label">{label}</span>
        <span className="gj-info-row-value">{value}</span>
      </div>
      {trailing}
    </div>
  );
}

export function Field({ label, required, error, children, className }: { label: ReactNode; required?: boolean; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={className ? `gj-field ${className}` : "gj-field"} data-required={required || undefined} data-invalid={error ? "true" : undefined}>
      <span>{label}</span>
      {children}
      {error && <small className="gj-field-error">{error}</small>}
    </label>
  );
}

export function EmptyState({ children, action, danger }: { children: ReactNode; action?: ReactNode; danger?: boolean }) {
  return (
    <div className={danger ? "gj-empty gj-empty--danger" : "gj-empty"}>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Alert({ tone = "neutral", children, role }: { tone?: "warning" | "danger" | "info" | "neutral"; children: ReactNode; role?: "alert" | "status" }) {
  return <div className={`gj-alert gj-alert--${tone}`} role={role}>{children}</div>;
}

export function Tabs({ items, activeId, onSelect, label }: {
  items: readonly { id: string; label: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <nav className="gj-tabs" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" className="gj-tab" aria-current={item.id === activeId ? "page" : undefined} onClick={() => onSelect(item.id)}>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function Dialog({ title, children, actions, onClose, labelledBy }: {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  labelledBy?: string;
}) {
  const titleId = labelledBy ?? "gj-dialog-title";
  return (
    <div className="gj-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="gj-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="gj-dialog-title" id={titleId}>{title}</h2>
        {children}
        {actions && <div className="gj-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
