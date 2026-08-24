import { useRef, useState } from "react";

import { ProjectPageFrame } from "../shell/AppShell";
import { Alert, Button, Dialog, EmptyState, Metric, Tag } from "../ui";
import type { ProjectCard } from "../workbench";
import "./ProjectList.css";

// P01 项目列表（66:1562）：标题行、三张指标卡、项目卡网格、新建卡。
// 指标口径按裁决记录第三节第 5 条；卡片上的每个数都来自 listProjectCards 的真实计数。
export interface ProjectListProps {
  cards: readonly ProjectCard[];
  onOpen: (projectId: string) => void;
  onCreate: () => void;
  onImport: (file: File) => Promise<void>;
  onClear: () => void;
  // 本机上的演示项目有新版本时提示（实施单元 09）
  demoUpdates: readonly { demoId: string; projectName: string }[];
  onUpdateDemo: () => void;
  loading: boolean;
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

export function ProjectList({ cards, onOpen, onCreate, onImport, onClear, demoUpdates, onUpdateDemo, loading }: ProjectListProps) {
  const importInput = useRef<HTMLInputElement>(null);
  // 更新与清空都会动本机数据，确认用页面内对话框（内嵌浏览器会把原生弹窗按取消处理）
  const [confirming, setConfirming] = useState<"update" | "clear" | null>(null);
  // 进行中 = 还没签发归档的项目；签发后归入已签发归档一格
  const active = cards.filter((card) => card.status === "active" && card.signedAt === null);
  const pending = cards.reduce((sum, card) => sum + card.pendingCount, 0);
  const signed = cards.filter((card) => card.signedAt !== null).length;
  const shortNames = active.map((card) => card.buildingName).join("、");
  return (
    <ProjectPageFrame
      title="项目列表"
      description="管理单栋建筑任务并进入成果生产链路"
      actions={<Button variant="primary" onClick={onCreate}>新建项目</Button>}
    >
      {demoUpdates.length > 0 && (
        <Alert tone="info">
          演示项目有新版本（{demoUpdates.map((item) => item.projectName).join("、")}）。本机上的是旧数据，更新会清空本机项目后重新装载。
          <Button variant="text" compact onClick={() => setConfirming("update")}>更新演示项目</Button>
        </Alert>
      )}
      {cards.some((card) => card.demoLimitationZh) && (
        <Alert tone="info">带展示项目标签的内容用于体验完整流程。项目内的演示实测值和随包签发记录不代表真实工程成果，本机也不能创建正式签发记录。</Alert>
      )}
      {confirming && (
        <Dialog
          title={confirming === "update" ? "更新演示项目" : "清空本机项目"}
          onClose={() => setConfirming(null)}
          actions={(
            <>
              <Button onClick={() => setConfirming(null)}>取消</Button>
              <Button variant="primary" onClick={() => { setConfirming(null); confirming === "update" ? onUpdateDemo() : onClear(); }}>
                {confirming === "update" ? "清空并更新" : "确认清空"}
              </Button>
            </>
          )}
        >
          <p className="gj-text-body">
            {confirming === "update"
              ? "更新会清空本机全部项目，然后重新装载新版演示项目。需要保留的项目请先导出项目包。"
              : "清空会删除本机全部项目与资料。需要保留的项目请先导出项目包。"}
          </p>
        </Dialog>
      )}
      <div className="sc-projects-metrics">
        <Metric label="进行中" value={loading ? "…" : active.length} note={loading ? "正在载入本机项目" : shortNames || (cards.length ? "全部已归档" : "还没有项目")} />
        <Metric label="待确认" value={loading ? "…" : pending} note="问题队列待处理项与识别候选" />
        <Metric label="已签发归档" value={loading ? "…" : signed} note={loading ? "正在核对项目状态" : cards.length ? (signed ? `${signed} 个项目包含复核签发记录` : `${cards.length} 个项目待签发`) : "尚无成果"} />
      </div>
      <div className="sc-projects-grid" aria-label="项目列表">
        {loading && <EmptyState>正在载入项目与展示内容。</EmptyState>}
        {!loading && cards.map((card) => (
          <article className="sc-project" key={card.projectId}>
            <div className="sc-project-cover">
              {card.coverUrl ? <img src={card.coverUrl} alt={`${card.buildingName} 照片`} /> : <span>{coverText(card)}</span>}
            </div>
            <div className="sc-project-info">
              <div className="sc-project-name">
                <h3>{card.name}</h3>
                <span className="gj-row">{card.demoLimitationZh && <Tag title={card.demoLimitationZh}>展示项目</Tag>}<Tag tone={card.signedAt ? "success" : card.status === "active" ? "accent" : "neutral"}>{card.signedAt ? "已归档" : card.status === "active" ? "进行中" : "已结束"}</Tag></span>
              </div>
              <p className="sc-project-sub">
                {[card.buildingName, card.scaleLabel, card.taskName].filter(Boolean).join(" · ")}
              </p>
              <p className="sc-project-counts">
                资料 {card.evidenceCount} 份，尺寸 {card.factCount} 条，构件 {card.objectCount} 个，成果 {card.artifactCount} 项
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
      {/* v4 标题行只有新建项目一个按钮；导入与清空是本机库的维护操作，放在页脚说明行，不进标题行 */}
      <div className="sc-projects-foot">
        <span>项目保存在本机。</span>
        <span>资料原件保存在本机，不会上传</span>
        <span className="gj-spacer" />
        <Button variant="text" onClick={() => importInput.current?.click()}>导入项目包</Button>
        <input ref={importInput} className="sr-only" type="file" accept=".json,.zip,application/json,application/zip"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file).finally(() => { event.target.value = ""; }); }} />
        <Button variant="text" onClick={() => setConfirming("clear")}>清空本机项目</Button>
      </div>
    </ProjectPageFrame>
  );
}
