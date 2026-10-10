import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectList, type ProjectListProps } from "./ProjectList";
import { projectCard } from "../test/project-card-fixture";

afterEach(cleanup);
function setup(props: Partial<ProjectListProps> = {}) {
  const onOpen = vi.fn();
  render(<ProjectList cards={[]} onOpen={onOpen} onCreate={vi.fn()} onImport={async () => undefined}
    onClear={vi.fn()} demoUpdates={[]} onRetryDemo={vi.fn()} onUpdateDemo={vi.fn()}
    loading={false} demoManifestEntries={[]} {...props} />);
  return onOpen;
}

describe("建筑制作首页", () => {
  it("100 项分页可检索、筛选、按项目查看并继续指定任务", () => {
    const cards = Array.from({ length: 100 }, (_, i) => projectCard({ projectId: "task-" + i, buildingName: "建筑" + i,
      name: "区域项目", taskName: "测绘" + i, pendingCount: i % 2 }));
    const onOpen = setup({ cards });
    expect(screen.getByText("第 1 / 5 页")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^继续制作：/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("第 2 / 5 页")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("检索建筑或任务"), { target: { value: "测绘99" } });
    fireEvent.change(screen.getByLabelText("查看范围"), { target: { value: "pending" } });
    fireEvent.click(screen.getByRole("button", { name: "按项目查看" }));
    expect(screen.getByRole("heading", { name: "区域项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续制作：建筑99" }));
    expect(onOpen).toHaveBeenCalledWith("task-99");
    expect(cards).toHaveLength(100);
  });

  it("检索无结果可以清除条件恢复任务", () => {
    setup({ cards: [projectCard({ artifactCount: 20, signedAt: "2026-09-01" })] });
    expect(screen.getByText("已有成果，待复查")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("检索建筑或任务"), { target: { value: "不存在" } });
    fireEvent.click(screen.getByRole("button", { name: "清除检索与筛选" }));
    expect(screen.getByRole("button", { name: "继续制作：山门" })).toBeInTheDocument();
  });

  it("空列表给出创建入口，加载状态不显示已完成", () => {
    setup();
    expect(screen.getByText("还没有制作任务。选择“创建制作任务”开始。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建制作任务" })).toBeEnabled();
    cleanup();
    setup({ loading: true });
    expect(screen.getByText("正在读取建筑任务。")).toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  });
});
