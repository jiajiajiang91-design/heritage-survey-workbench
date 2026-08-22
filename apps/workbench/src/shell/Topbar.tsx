import { PanelRightOpen } from "lucide-react";

import { Button } from "../ui";

// 顶栏（V3/Topbar 35:14）：只承载产品标识、项目上下文和项目级导航。
export interface TopbarProps {
  breadcrumb: string | null;
  pages: readonly { id: string; label: string; active: boolean }[];
  projectListActive: boolean;
  // 没有进入项目时两个项目级页面没有对象，按 v4 形式仍显示在顶栏，但不可点
  pagesEnabled: boolean;
  onProjectList: () => void;
  onSelectPage: (id: string) => void;
  assistantToggle?: { collapsed: boolean; onToggle: () => void } | null;
}

export function Topbar({ breadcrumb, pages, projectListActive, pagesEnabled, onProjectList, onSelectPage, assistantToggle }: TopbarProps) {
  return (
    <header className="ws-topbar">
      <div className="ws-brand">
        <span className="ws-brand-mark" aria-hidden="true">建</span>
        <h1 className="ws-brand-name">古建保护成果工作台</h1>
      </div>
      {breadcrumb && <>
        <span className="ws-topbar-divider" aria-hidden="true" />
        <span className="ws-breadcrumb" title={breadcrumb}>{breadcrumb}</span>
      </>}
      <span className="ws-topbar-spacer" />
      <nav className="ws-topbar-nav" aria-label="项目级页面">
        <button type="button" aria-current={projectListActive ? "page" : undefined} onClick={onProjectList}>项目列表</button>
        {pages.map((page) => (
          <button key={page.id} type="button" aria-current={page.active ? "page" : undefined} disabled={!pagesEnabled} onClick={() => onSelectPage(page.id)}>{page.label}</button>
        ))}
      </nav>
      {/* v4 顶栏没有助手开关；只在助手栏收起时（窄屏）给一个唤起入口，裁决记录第一节第 5 条 */}
      {assistantToggle && (
        <div className="ws-topbar-tools">
          <Button icon onClick={assistantToggle.onToggle} aria-label="展开助手面板"><PanelRightOpen size={16} /></Button>
        </div>
      )}
    </header>
  );
}
