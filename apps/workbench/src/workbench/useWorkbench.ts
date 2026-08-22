import type { DemoLoadResult } from "../demo-library-loader";
import { bootstrapDemoProjects } from "../workbench";
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
  const chooseProject = async (projectId: string) => {
    jobs.resetModelProgress();
    await session.chooseProject(projectId);
  };

  // 新建或导入后进入建立任务（W01）：先确认对象、范围与成果要求，再整理资料（实施单元 08 偏离清单）。
  const createProject = async (values: CreateProjectValues): Promise<boolean> => {
    const head = await session.createProject(values);
    if (!head) return false;
    nav.setActiveStage("tasks");
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
