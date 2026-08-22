import { useRef, useState } from "react";
import { buildArtifactMatrix, type CadJobProgress } from "@gujian/infrastructure";

import { describeFailure, inputError } from "../failure-notice";
import { useDelayedIndicator } from "../LongTask";
import type { ModelRunProgress } from "../model-run-client";
import { cadJobs, drawingJobs, localActorId, modelRuns, projectPackages, projectRepository, workflow } from "../workbench";
import { triggerDownload } from "./download";
import type { Notices } from "./useNotices";
import type { ProjectSession } from "./useProjectSession";
import type { WorkspaceNav } from "./useWorkspaceNav";

const FINISHED_PHASES = ["succeeded", "failed", "cancelled"];

// 取消是用户主动的结果，与作业失败要分开处理。
function isCancelled(reason: unknown): boolean {
  return reason instanceof Error && /_CANCELLED$/.test(reason.message);
}

interface JobDeps {
  session: ProjectSession;
  nav: WorkspaceNav;
  notices: Notices;
}

// 四条长任务：模型识别、几何生成、出图、导出。进度、取消与指示器门槛都在这里。
export function useJobs({ session, nav, notices }: JobDeps) {
  const { setError, setNotice } = notices;
  const { selected, setSelected, refresh, loadProject, geometrySpec, geometryRevision, readableDrawingEvidenceIds } = session;
  const [modelProgress, setModelProgress] = useState<ModelRunProgress | null>(null);
  const [cadProgress, setCadProgress] = useState<CadJobProgress | null>(null);
  const [drawingProgress, setDrawingProgress] = useState<string | null>(null);
  const [cadCancelling, setCadCancelling] = useState(false);
  // 从点击到作业首个事件之间有一段准备工作（规则留痕、构件规格组装、建立会话）。
  // 这段时间也属于用户在等，必须同样进入加载态，否则按钮还能再点，会重复提交。
  const [geometryStarting, setGeometryStarting] = useState(false);
  // 取消意图记在界面这一侧。取消请求发出后作业流会先断，客户端拿到的是
  // 连接错误而不是取消事件，只靠错误内容判断会把取消显示成失败。
  const cadCancelRequested = useRef(false);
  const drawingCancelRequested = useRef(false);
  const [drawingCancelling, setDrawingCancelling] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ phase: string; cancelling: boolean } | null>(null);
  const exportCancelled = useRef(false);

  const modelRunning = Boolean(modelProgress && !FINISHED_PHASES.includes(modelProgress.phase));
  // 三个长任务的运行判定与指示器门槛（07 表 7）：短于 300 ms 不显示指示器
  const geometryRunning = geometryStarting
    || Boolean(cadProgress && !FINISHED_PHASES.includes(cadProgress.phase));
  const drawingRunning = Boolean(drawingProgress && !FINISHED_PHASES.includes(drawingProgress));
  const exportRunning = Boolean(exportProgress);
  const showGeometryTask = useDelayedIndicator(geometryRunning);
  const showDrawingTask = useDelayedIndicator(drawingRunning);
  const showExportTask = useDelayedIndicator(exportRunning);

  const generateDemoGeometry = async () => {
    if (!selected) return;
    setError(null);
    setCadProgress(null);
    setCadCancelling(false);
    setGeometryStarting(true);
    cadCancelRequested.current = false;
    try {
      const outcome = await cadJobs.startGeometry(
        selected,
        localActorId(),
        setCadProgress,
        geometrySpec ? { mode: "existingGeometrySpec", geometrySpecId: geometrySpec.id } : { mode: "derivedFromFacts" },
      );
      setSelected(outcome.head);
      await refresh();
      setNotice("三维模型已生成。成果尚未经专业复核签发，不能用于正式交付");
    } catch (reason) {
      setCadProgress(null);
      // 用户主动取消不是失败，不进失败提示。
      if (cadCancelRequested.current || isCancelled(reason)) setNotice("三维模型生成已取消，本机数据保持在生成前的状态");
      else setError(describeFailure(reason, "几何作业失败"));
    } finally {
      setGeometryStarting(false);
      setCadCancelling(false);
    }
  };

  const cancelGeometry = async () => {
    cadCancelRequested.current = true;
    setCadCancelling(true);
    try { await cadJobs.cancel(); } catch { /* 取消失败时作业仍会自然结束 */ }
  };

  const generateDrawings = async () => {
    if (!selected || !geometryRevision || !geometrySpec) return;
    setError(null); setDrawingProgress("queued"); setDrawingCancelling(false);
    drawingCancelRequested.current = false;
    try {
      const matrix = buildArtifactMatrix(selected, geometryRevision, geometrySpec);
      const outcome = await drawingJobs.generate(selected, localActorId(), geometryRevision, matrix, setDrawingProgress);
      setSelected(outcome.head); await loadProject(selected.projectId); await refresh(); setNotice("成组图纸已生成，各图与同一版三维模型一致");
    } catch (reason) {
      setDrawingProgress(null);
      if (drawingCancelRequested.current || isCancelled(reason)) setNotice("图纸生成已取消，本机数据保持在生成前的状态");
      else setError(describeFailure(reason, "图纸作业失败"));
    } finally {
      setDrawingCancelling(false);
    }
  };

  const cancelDrawings = async () => {
    drawingCancelRequested.current = true;
    setDrawingCancelling(true);
    try { await drawingJobs.cancel(); } catch { /* 同上 */ }
  };

  // 导出是本机流程，没有服务端作业可以终止，因此按阶段推进并在每个阶段
  // 之间检查取消标志。取消后不落文件，界面回到导出前的状态。
  const downloadProject = async (type: "json" | "zip") => {
    if (!selected || exportProgress) return;
    setError(null);
    exportCancelled.current = false;
    setExportProgress({ phase: "组装项目记录", cancelling: false });
    try {
      const bytes = type === "json"
        ? await projectPackages.exportJson(selected.projectId)
        : await projectPackages.exportZip(selected.projectId);
      if (exportCancelled.current) { setNotice("导出已取消，未产生文件"); return; }
      setExportProgress({ phase: "写出文件", cancelling: false });
      const blob = new Blob([bytes as BlobPart], { type: type === "json" ? "application/json" : "application/zip" });
      triggerDownload(blob, `${selected.snapshot.project.name}.${type === "json" ? "project.json" : "gujian.zip"}`);
      setNotice(`已导出 ${type.toUpperCase()} 项目包`);
    } catch (reason) {
      setExportProgress(null);
      setError(describeFailure(reason, "项目包导出失败"));
      return;
    } finally {
      setExportProgress(null);
    }
  };

  const cancelExport = () => {
    exportCancelled.current = true;
    setExportProgress((current) => current ? { ...current, cancelling: true } : current);
  };

  // 重新识别：有图像资料就认构件，没有就退回资料要点整理。
  // 前者产出带图上位置的构件，框选修正才能按位置对应到构件。
  const runModel = async () => {
    if (!selected) return;
    setError(null);
    setModelProgress(null);
    try {
      const imageIds = readableDrawingEvidenceIds;
      const outcome = imageIds.length
        ? await modelRuns.runComponentRecognition(selected, localActorId(), imageIds, setModelProgress)
        : await modelRuns.runEvidenceSummary(selected, localActorId(), setModelProgress);
      const evaluated = await workflow.evaluate(outcome.head, localActorId());
      setSelected(evaluated);
      session.setProjectModelRuns(await projectRepository.getProjectModelRuns(selected.projectId));
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(selected.projectId));
      nav.setActiveStage("candidates");
      setNotice(outcome.candidate ? "助手已给出识别结果，请在待确认区逐条核对" : "本次识别没有产生可用结果");
      await refresh();
    } catch (reason) {
      setError(describeFailure(reason, "模型运行失败"));
    }
  };

  // 图纸尺寸转写：读出图上已标注的尺寸进待确认区。
  // 只对图像类资料可用，人工确认后才写入尺寸事实。
  const transcribeDrawings = async () => {
    if (!selected) return;
    const drawingIds = readableDrawingEvidenceIds;
    if (!drawingIds.length) {
      setError(inputError("本项目没有可读取的图纸资料。先上传 JPEG、PNG 或 WebP 格式的实测图。"));
      return;
    }
    setError(null);
    setModelProgress(null);
    try {
      const outcome = await modelRuns.runMeasurementTranscription(selected, localActorId(), drawingIds, setModelProgress);
      const evaluated = await workflow.evaluate(outcome.head, localActorId());
      setSelected(evaluated);
      session.setProjectModelRuns(await projectRepository.getProjectModelRuns(selected.projectId));
      nav.setActiveStage("candidates");
      const count = outcome.candidate?.structured?.kind === "measurementTranscription"
        ? outcome.candidate.structured.dimensions.length
        : 0;
      setNotice(count
        ? `从图纸读出 ${count} 条尺寸，请在待确认区逐条核对后再写入项目`
        : "本次读取没有得到可用尺寸");
      await refresh();
    } catch (reason) {
      setError(describeFailure(reason, "图纸尺寸读取失败"));
    }
  };

  const cancelModel = () => { void modelRuns.cancel(); };
  const resetModelProgress = () => setModelProgress(null);

  const jobProgressSummary = () => {
    const lines = [
      modelProgress && "助手正在识别资料",
      cadProgress && "正在生成三维模型",
      drawingProgress && `图纸作业：${drawingProgress}`,
    ].filter(Boolean);
    return lines.length ? lines.join("；") : "当前没有进行中的作业";
  };

  return {
    modelProgress, cadProgress, drawingProgress, exportProgress,
    cadCancelling, drawingCancelling,
    modelRunning, geometryRunning, drawingRunning, exportRunning,
    showGeometryTask, showDrawingTask, showExportTask,
    generateDemoGeometry, cancelGeometry, generateDrawings, cancelDrawings,
    downloadProject, cancelExport, runModel, transcribeDrawings, cancelModel, resetModelProgress,
    jobProgressSummary,
  };
}

export type Jobs = ReturnType<typeof useJobs>;
