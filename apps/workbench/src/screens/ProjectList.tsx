import { useRef, useState } from "react";

import { ProjectPageFrame } from "../shell/AppShell";
import { Alert, Button, Dialog, EmptyState, Tag } from "../ui";
import { productionSummary, visibleTaskCards, type TaskFilter } from "../project-progress";
import type { ProjectCard } from "../workbench";
import type { DemoLibraryEntry, DemoLibraryUpdate } from "../demo-library-loader";
import "./ProjectList.css";

export interface ProjectListProps {
  cards: readonly ProjectCard[];
  onOpen: (projectId: string, showExample?: boolean) => void;
  onCreate: () => void;
  onImport: (file: File) => Promise<void>;
  onClear: () => void;
  demoUpdates: readonly DemoLibraryUpdate[];
  onRetryDemo: () => void;
  onUpdateDemo: () => void;
  loading: boolean;
  demoManifestEntries: readonly DemoLibraryEntry[];
}

const PAGE_SIZE = 20;

export function ProjectList({ cards, onOpen, onCreate, onImport, onClear, demoUpdates, onRetryDemo, onUpdateDemo, loading, demoManifestEntries }: ProjectListProps) {
  const importInput = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<"update" | "clear" | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [grouped, setGrouped] = useState(false);
  const [page, setPage] = useState(1);
  const visible = visibleTaskCards(cards, search, filter);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageCards = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const groups = grouped
    ? [...new Set(pageCards.map((card) => card.name))].map((name) => ({ name, cards: pageCards.filter((card) => card.name === name) }))
    : [{ name: "", cards: pageCards }];
  const active = cards.filter((card) => card.status === "active").length;
  const pending = cards.reduce((sum, card) => sum + card.pendingCount, 0);
  const results = cards.filter((card) => card.artifactCount > 0).length;
  const examples = cards.filter((card) => card.demoLimitationZh);
  const missingOnly = demoUpdates.length > 0 && demoUpdates.every((item) => item.kind === "missing");
  const loadingEntries = loading ? demoManifestEntries.filter((entry) => !cards.some((card) => card.projectId === entry.projectId)) : [];
  const reset = () => { setSearch(""); setFilter("all"); setPage(1); };

  return (
    <ProjectPageFrame title="建筑制作任务" description="从已有图纸、照片、尺寸记录，预览核对后制作模型与图纸。"
      actions={<Button variant="primary" onClick={onCreate}>创建制作任务</Button>}>
      {examples.length > 0 && <section className="sc-projects-examples" aria-labelledby="sc-projects-examples-title">
        <div className="sc-projects-examples-info">
          <h2 className="sc-projects-section-title" id="sc-projects-examples-title">先看示例</h2>
          <p className="sc-projects-source">预置案例，包含预置或模拟数据。适用范围见各任务的展示标签。</p>
        </div>
        <div className="sc-projects-example-links">{examples.map((card) => <Button key={card.projectId} compact
          aria-label={"查看预置案例：" + card.buildingName + (card.taskName ? "，" + card.taskName : "")}
          title={card.demoLimitationZh ?? undefined} onClick={() => onOpen(card.projectId, true)}>
          {card.buildingName}{card.taskName && " · " + card.taskName}
        </Button>)}</div>
      </section>}
      {demoUpdates.length > 0 && (
        <Alert tone="info">
          {missingOnly
            ? "部分展示项目尚未载入，可继续载入。"
            : "展示项目有新版本。更新会清空本机项目，请先导出需要保留的项目包。"}
          <Button variant="text" compact onClick={missingOnly ? onRetryDemo : () => setConfirming("update")}>{missingOnly ? "继续载入" : "更新展示项目"}</Button>
        </Alert>
      )}
      {!examples.length && loadingEntries.length > 0 && (
        <p className="sc-projects-source">正在载入预置案例，完成后可从示例入口查看。</p>
      )}
      {confirming && (
        <Dialog title={confirming === "update" ? "更新演示项目" : "清空本机项目"} onClose={() => setConfirming(null)}
          actions={<><Button onClick={() => setConfirming(null)}>取消</Button>
            <Button variant="primary" onClick={() => { setConfirming(null); confirming === "update" ? onUpdateDemo() : onClear(); }}>
              {confirming === "update" ? "清空并更新" : "确认清空"}
            </Button></>}>
          <p className="gj-text-body">{confirming === "update"
            ? "更新会清空本机全部项目，然后重新装载新版演示项目。需要保留的项目请先导出项目包。"
            : "清空会删除本机全部项目与资料。需要保留的项目请先导出项目包。"}</p>
        </Dialog>
      )}
      <div className="sc-projects-summary">
        <h2 className="sc-projects-section-title">制作任务</h2>
        {(cards.length > 0 || loading) && <p className="sc-projects-counts">
          <span>进行中任务 {loading ? "载入中" : active}</span>
          <span>待处理事项 {loading ? "载入中" : pending}</span>
          <span title="已有文件，仍需核对任务与质量">已有成果任务 {loading ? "载入中" : results}</span>
        </p>}
      </div>
      <div className="sc-projects-tools">
        <label className="gj-field sc-projects-search">检索建筑或任务
          <input type="search" value={search} placeholder="输入建筑、任务或项目名称"
            onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <label className="gj-field">查看范围
          <select value={filter} onChange={(event) => { setFilter(event.target.value as TaskFilter); setPage(1); }}>
            <option value="all">全部任务</option><option value="active">进行中</option>
            <option value="pending">有待处理事项</option><option value="results">已有成果</option>
          </select>
        </label>
        <Button variant="text" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>{grouped ? "按任务查看" : "按项目查看"}</Button>
      </div>
      <div className="sc-projects-result-count" role="status">{loading ? "正在读取任务摘要" : "共 " + visible.length + " 项任务"}{!loading && "，待处理优先，按最近修改排列"}</div>
      <div className="sc-projects-list" aria-label="建筑任务列表">
        {!loading && !cards.length && <EmptyState>还没有制作任务。选择“创建制作任务”开始。</EmptyState>}
        {cards.length > 0 && !visible.length && <EmptyState>没有符合条件的任务。<Button onClick={reset}>清除检索与筛选</Button></EmptyState>}
        {loading && !cards.length && !loadingEntries.length && <EmptyState>正在读取建筑任务。</EmptyState>}
        {groups.map((group) => <section className="sc-projects-group" key={group.name}>
          {group.name && <h3 className="sc-projects-group-name">{group.name}</h3>}
          {group.cards.map((card) => {
            const progress = productionSummary(card);
            return <article className="sc-project" key={card.projectId}>
              <div className="sc-project-info">
                <div className="sc-project-name"><h3>{card.buildingName}</h3>
                  <span className="gj-row">{card.demoLimitationZh && <Tag title={card.demoLimitationZh}>展示数据</Tag>}
                    <Tag tone={card.pendingCount ? "warning" : "neutral"}>{progress.label}</Tag></span>
                </div>
                <p className="sc-project-sub">{card.taskName ?? "尚未定义成果要求"}{card.scaleLabel && " · " + card.scaleLabel}</p>
                {!card.pendingCount && <p className="sc-project-next">{progress.next}</p>}
                <p className="sc-project-sub">{card.pendingCount + " 项待处理 · 最近修改 " + card.updatedAt.slice(0, 10)}</p>
              </div>
              <Button aria-label={"继续制作：" + card.buildingName} onClick={() => onOpen(card.projectId)}>继续制作</Button>
            </article>;
          })}
        </section>)}
        {loadingEntries.map((entry) => <article className="sc-project" key={entry.projectId} aria-busy="true">
          <div className="sc-project-info"><div className="sc-project-name"><h3>{entry.buildingName}</h3><Tag>载入中</Tag></div>
            <p className="sc-project-sub">正在载入展示任务，完成后可以查看。</p></div><Button disabled>载入中</Button>
        </article>)}
      </div>
      {pageCount > 1 && <nav className="sc-projects-pages" aria-label="任务分页">
        <Button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
        <span>{"第 " + currentPage + " / " + pageCount + " 页"}</span>
        <Button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</Button>
      </nav>}
      <div className="sc-projects-foot">
        <span>项目与资料保存在本机。AI 处理按本次选择发送资料。</span>
        <details><summary>项目维护</summary><div className="gj-row">
          <Button variant="text" onClick={() => importInput.current?.click()}>导入项目包</Button>
          <Button variant="text" onClick={() => setConfirming("clear")}>清空本机项目</Button>
        </div></details>
        <input ref={importInput} className="sr-only" type="file" accept=".json,.zip,application/json,application/zip"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file).finally(() => { event.target.value = ""; }); }} />
      </div>
    </ProjectPageFrame>
  );
}
