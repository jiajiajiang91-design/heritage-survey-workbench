import { X } from "lucide-react";
import type { ReactNode } from "react";

import type { FailureNotice } from "../failure-notice";
import { Tabs } from "../ui";

// 总体网格：顶栏在上，下面三栏（左栏 240 / 中栏自适应 / 助手栏 380）。
// 项目级页面与项目列表只占一栏。三档断点在 shell.css。
export function AppShell({ topbar, rail, center, assistant, single, assistantCollapsed, banners }: {
  topbar: ReactNode;
  rail?: ReactNode;
  center: ReactNode;
  assistant?: ReactNode;
  single: boolean;
  assistantCollapsed: boolean;
  banners?: ReactNode;
}) {
  const bodyClass = ["ws-body", single && "ws-body--single", !single && assistantCollapsed && "ws-body--assistant-collapsed"].filter(Boolean).join(" ");
  return (
    <main className="ws-app">
      {topbar}
      <div className={bodyClass}>
        {!single && rail}
        {center}
        {!single && assistant}
      </div>
      {banners}
    </main>
  );
}

// 中栏容器（66:1603）：页头、页签行、内容区。页签行按 v4 形式始终显示。
export function CenterFrame({ title, description, actions, tabs, children, fill }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: { items: readonly { id: string; label: string }[]; activeId: string; onSelect: (id: string) => void } | null;
  children: ReactNode;
  // 内容自己滚动（分栏视图）时由内容管溢出，容器不再滚
  fill?: boolean;
}) {
  return (
    <section className="ws-center">
      <div className="ws-page-header">
        <div>
          <h2 className="ws-page-title">{title}</h2>
          {description && <p className="ws-page-description">{description}</p>}
        </div>
        {actions}
      </div>
      {tabs && <Tabs items={tabs.items} activeId={tabs.activeId} onSelect={tabs.onSelect} label="工作区视图" />}
      <div className={fill ? "ws-center-body ws-center-body--fill" : "ws-center-body"}>{children}</div>
    </section>
  );
}

// 项目级页面框架（P01 至 P03）：单栏，内容最大宽 1120。返回条回到进入之前那个视图。
export function ProjectPageFrame({ title, description, actions, back, children }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { label: string; onBack: () => void } | null;
  children: ReactNode;
}) {
  return (
    <section className="ws-page">
      <div className="ws-page-inner">
        {back && <button type="button" className="ws-back" onClick={back.onBack}>← 回到{back.label}</button>}
        <div className="ws-page-titlebar">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Banners({ error, notice, onDismissError, onDismissNotice }: {
  error: FailureNotice | null;
  notice: string | null;
  onDismissError: () => void;
  onDismissNotice: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div className="ws-banners">
      {error && (
        <div className="ws-banner ws-banner--error" role="alert">
          <div><span>{error.summaryZh}</span>{error.nextStepZh && <em>{error.nextStepZh}</em>}</div>
          <button type="button" onClick={onDismissError} aria-label="关闭提示"><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="ws-banner ws-banner--notice" role="status">
          <div><span>{notice}</span></div>
          <button type="button" onClick={onDismissNotice} aria-label="关闭提示"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
