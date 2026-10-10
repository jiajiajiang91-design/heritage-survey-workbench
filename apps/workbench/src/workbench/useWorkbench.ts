import type { DemoLoadResult } from "../demo-library-loader";
import { prepareEvidenceFiles, bootstrapDemoProjects } from "../workbench";
import { useAssistantBridge } from "./useAssistantBridge";
import { useEvidencePane } from "./useEvidencePane";
import { useJobs } from "./useJobs";
import { useNotices } from "./useNotices";
import { useProjectSession, type CreateProjectValues } from "./useProjectSession";
import { useRecordWrites } from "./useRecordWrites";
import { useWorkspaceNav } from "./useWorkspaceNav";

export interface WorkbenchOptions {
  // 首次打开的演示项目装载。默认走真实装载，测试注入空实现，
  // 测试进程里就不存在无法等待的后台写入与网络请求。
  bootstrapDemo?: () => Promise<DemoLoadResult | null>;
}

// 工作台控制器的门面。六个 hook 按依赖单向组合：
// notices → session → nav → evidence → jobs → writes → assistant。
// 页面只拿这里返回的切片与回调，不直接碰仓库与服务。
export function useWorkbench({ bootstrapDemo = bootstrapDemoProjects }: WorkbenchOptions = {}) {
  const notices = useNotices();
  const session = useProjectSession({ bootstrapDemo, notices });
  const nav = useWorkspaceNav(session);
  const evidence = useEvidencePane(session);
  const jobs = useJobs({ session, nav, notices });
  const writes = useRecordWrites({ session, notices });
  const assistant = useAssistantBridge({ session, nav, jobs, evidence, writes, notices });

  // 跨 hook 的组合动作放在门面里，各 hook 之间不互相引用。
  // 从列表进项目：上一个项目的几何选中项清掉；停在项目级页面（运行与用量、修改历史）时回到资料清单，
  // 不让新项目一进来就落在修改历史上。
  const chooseProject = async (projectId: string, showExample = false) => {
    jobs.resetModelProgress();
    nav.setSelectedGeometryEntityId(null);
    notices.setError(null);
    notices.setNotice(null);
    nav.setDimensionCandidateSelection(null);
    nav.setDimensionReturnView(null);
    nav.setComponentCandidateSelection(null);
    const card = session.projectCards.find((item) => item.projectId === projectId);
    const head = await session.chooseProject(projectId);
    const hasPreview = head?.snapshot.candidates.some((candidate) => candidate.structured?.kind === "measurementTranscription" || candidate.structured?.kind === "componentRecognition");
    nav.setActiveStage(showExample && card?.objectCount ? "geometry" : !card?.taskName ? "tasks" : !card.evidenceCount ? "evidence" : card.outputUnitPending ? "geometry" : card.pendingCount && hasPreview ? "preview" : card.artifactCount ? "checks" : card.objectCount ? "objects" : "evidence");
  };

  // 新建或导入后进入建立任务（W01）：先确认对象、范围与成果要求，再整理资料（实施单元 08 偏离清单）。
  const createProject = async (values: CreateProjectValues, files: readonly import("../production-task").PreparedFile[] = [], destination: "tasks" | "evidence" | "list" = "tasks"): Promise<boolean> => {
    const head = await session.createProject(values);
    if (!head) return false;
    try {
      const prepared = await prepareEvidenceFiles(head, files);
      session.setSelected(prepared.head);
      await session.loadProject(head.projectId);
      await session.refresh();
      if (prepared.failures.length) notices.setError({ summaryZh: "部分资料尚未就绪：" + prepared.failures.join("；"), nextStepZh: "已保存原件可在资料清单重试；未保存文件可重新添加。" });
      else notices.setNotice(files.length ? files.length + " 份资料已保存，可以继续准备与核对。" : "任务草稿已保存，可以补充资料。");
    } catch { notices.setError({ summaryZh: "任务已保存，资料准备或页面刷新未完成。", nextStepZh: "重新进入任务，查看已保存资料并补充缺项。" }); }
    if (destination === "list") { session.exitToProjectList(); nav.setActiveStage("tasks"); } else nav.setActiveStage(destination);
    return true;
  };

  const importProject = async (file: File): Promise<boolean> => {
    const ok = await session.importProject(file);
    if (ok) nav.setActiveStage("tasks");
    return ok;
  };

  return { notices, session, nav, evidence, jobs, writes, assistant, chooseProject, createProject, importProject };
}

export type Workbench = ReturnType<typeof useWorkbench>;
