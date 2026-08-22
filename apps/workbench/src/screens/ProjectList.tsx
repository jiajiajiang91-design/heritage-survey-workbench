import { useRef } from "react";

import { ProjectPageFrame } from "../shell/AppShell";
import { Button, Metric, Tag } from "../ui";
import type { ProjectCard } from "../workbench";
import "./ProjectList.css";

// P01 项目列表（66:1562）：标题行、三张指标卡、项目卡网格、新建卡。
// 指标口径按裁决记录第三节第 5 条；卡片上的每个数都来自 listProjectCards 的真实计数。
export interface ProjectListProps {
  cards: readonly ProjectCard[];
  query: string;
  onQuery: (value: string) => void;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
  onImport: (file: File) => Promise<void>;
  onClear: () => void;
}

function coverText(card: ProjectCard): string {
  if (!card.evidenceCount) return "尚未上传资料";
  const parts: string[] = [];
  if (card.drawingCount) parts.push(`${card.drawingCount} 份图纸`);
  if (card.photoCount) parts.push(`${card.photoCount} 张照片`);
  const other = card.evidenceCount - card.drawingCount - card.photoCount;
  if (other > 0) parts.push(`${other} 份文档或记录`);
  return card.photoCount ? parts.join("、") : `${parts.join("、")}，无现场照片`;
}

export function ProjectList({ cards, query, onQuery, onOpen, onCreate, onImport, onClear }: ProjectListProps) {
  const importInput = useRef<HTMLInputElement>(null);
  const visible = cards.filter((card) => `${card.name}${card.buildingName}`.toLowerCase().includes(query.toLowerCase()));
  const active = cards.filter((card) => card.status === "active");
  const pending = cards.reduce((sum, card) => sum + card.pendingCount, 0);
  const checked = cards.reduce((sum, card) => sum + card.checkedArtifactCount, 0);
  const shortNames = active.map((card) => card.buildingName).join("、");
  return (
    <ProjectPageFrame
      title="项目列表"
      description="管理单栋建筑任务并进入成果生产链路"
      actions={(
        <div className="sc-projects-tools">
          <label className="sc-projects-search">
            <span className="sr-only">搜索项目</span>
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索项目或建筑" />
          </label>
          <Button onClick={() => importInput.current?.click()}>导入项目包</Button>
          <input ref={importInput} className="sr-only" type="file" accept=".json,.zip,application/json,application/zip"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file).finally(() => { event.target.value = ""; }); }} />
          <Button variant="primary" onClick={onCreate}>新建项目</Button>
        </div>
      )}
    >
      <div className="sc-projects-metrics">
        <Metric label="进行中" value={active.length} note={shortNames || "还没有项目"} />
        <Metric label="待确认" value={pending} note="问题队列待处理项与识别候选" />
        <Metric label="通过检查的成果" value={checked} note={cards.length ? (checked ? `${cards.filter((card) => card.checkedArtifactCount).length} 个项目有通过检查的成果` : `${cards.length} 个项目全部未获资格`) : "尚无成果"} />
      </div>
      <div className="sc-projects-grid" aria-label="项目列表">
        {visible.map((card) => (
          <article className="sc-project" key={card.projectId}>
            <div className="sc-project-cover">
              {card.coverUrl ? <img src={card.coverUrl} alt={`${card.buildingName} 照片`} /> : <span>{coverText(card)}</span>}
            </div>
            <div className="sc-project-info">
              <div className="sc-project-name">
                <h3>{card.name}</h3>
                <Tag tone={card.status === "active" ? "success" : "neutral"}>{card.status === "active" ? "进行中" : "已归档"}</Tag>
              </div>
              <p className="sc-project-sub">
                {[card.buildingName, card.scaleLabel, card.taskName].filter(Boolean).join(" · ")}
              </p>
              <p className="sc-project-counts">
                资料 {card.evidenceCount} 份，事实 {card.factCount} 条，构件 {card.objectCount} 个，成果 {card.artifactCount} 项
              </p>
              <div className="gj-actions">
                <Button variant="primary" onClick={() => onOpen(card.projectId)}>进入任务</Button>
              </div>
            </div>
          </article>
        ))}
        <button type="button" className="sc-project sc-project--new" onClick={onCreate}>
          <span className="sc-project-plus" aria-hidden="true">＋</span>
          <strong>新建项目</strong>
          <span>录入对象、范围和成果要求后开始</span>
        </button>
      </div>
      <div className="sc-projects-foot">
        <span>项目保存在本机。</span>
        <span>资料原件保存在本机，不会上传</span>
        <span className="gj-spacer" />
        <Button variant="text" onClick={onClear}>清空本机项目</Button>
      </div>
    </ProjectPageFrame>
  );
}
