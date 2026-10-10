import { useRef, useState } from "react";
import { buildArtifactMatrix, hasComponentInputs, type CadJobProgress } from "@gujian/infrastructure";

import { previewInputErrors } from "../preview-read-model";
import { evidenceReadability } from "../evidence-readability";
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
  const selectedProjectId = useRef(selected?.projectId);
  selectedProjectId.current = selected?.projectId;
  const [modelStarting, setModelStarting] = useState(false);
  const modelPending = useRef(false);
  const modelCancelled = useRef(false);
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

  const modelRunning = modelStarting || Boolean(modelProgress && !FINISHED_PHASES.includes(modelProgress.phase));
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
        geometrySpec && !hasComponentInputs(selected) ? { mode: "existingGeometrySpec", geometrySpecId: geometrySpec.id } : { mode: "derivedFromFacts" },
      );
      setSelected(outcome.head);
      await refresh();
      setNotice("三维模型已生成。成果尚未经专业复核签发，不能用于正式交付");
    } catch (reason) {
      setCadProgress(null);
      // 用户主动取消不是失败，不进失败提示。
      if (cadCancelRequested.current || isCancelled(reason)) setNotice("三维模型生成已取消，本机数据保持在生成前的状态");
      else setError(describeFailure(reason, "建模作业失败"));
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
    if (!selected || modelPending.current) return;
    modelPending.current = true; modelCancelled.current = false; setModelStarting(true);
    setError(null);
    setModelProgress(null);
    try {
      const selectedIds = session.selectedModelEvidenceIds;
      if (!selectedIds.length) throw new Error("本次没有选择资料，请在资料清单勾选可读输入。");
      const imageIds = selectedIds.filter((id) => readableDrawingEvidenceIds.includes(id));
      const textOnly = imageIds.length ? selectedIds.filter((id) => !imageIds.includes(id)).map((id) => selected.snapshot.evidences.find((e) => e.id === id)?.title ?? id) : [];
      const selectionNote = textOnly.length ? "文字资料不用于构件定位：" + textOnly.join("、") + "。可在资料页读取尺寸。" : "";
      if (selectionNote) setNotice(selectionNote);
      const outcome = imageIds.length
        ? await modelRuns.runComponentRecognition(selected, localActorId(), imageIds, setModelProgress)
        : await modelRuns.runEvidenceSummary(selected, localActorId(), setModelProgress, selectedIds);
      const evaluated = await workflow.evaluate(outcome.head, localActorId());
      setSelected(evaluated);
      session.setProjectModelRuns(await projectRepository.getProjectModelRuns(selected.projectId));
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(selected.projectId));
      nav.setActiveStage("candidates");
      setNotice((outcome.candidate ? "助手已给出识别结果，请在待确认区逐条核对。" : "本次识别没有产生可用结果。") + selectionNote);
      await refresh();
    } catch (reason) {
      setError(describeFailure(reason, "模型运行失败"));
    } finally { modelPending.current = false; setModelStarting(false); }
  };

  // 图纸尺寸转写：读出图上已标注的尺寸进待确认区。
  // 只对图像类资料可用，人工确认后才写入尺寸事实。
  const transcribeDrawings = async (selectedIds?: readonly string[], destination: "measurements" | "preview" = "measurements") => {
    if (!selected || modelPending.current) return;
    const drawingIds = selectedIds ?? session.selectedModelEvidenceIds;
    if (!drawingIds.length) {
      setError(inputError("本次没有选择可读资料。先完成资料读取并选择输入。"));
      return;
    }
    modelPending.current = true; modelCancelled.current = false; setModelStarting(true);
    setError(null);
    setModelProgress(null);
    try {
      const outcome = await modelRuns.runMeasurementTranscription(selected, localActorId(), drawingIds, setModelProgress);
      const evaluated = await workflow.evaluate(outcome.head, localActorId());
      setSelected(evaluated);
      session.setProjectModelRuns(await projectRepository.getProjectModelRuns(selected.projectId));
      if (outcome.candidate) nav.setActiveStage(destination);
      const count = outcome.candidate?.structured?.kind === "measurementTranscription"
        ? outcome.candidate.structured.dimensions.length
        : 0;
      setNotice(count
        ? `读出 ${count} 条标注，请对照原件逐条核对后采用`
        : "本次读取未得到可用标注，已有结果保留。");
      await refresh();
    } catch (reason) {
      setError(describeFailure(reason, "图纸尺寸读取失败"));
    } finally { modelPending.current = false; setModelStarting(false); }
  };
  const generatePreview = async (ids?: readonly string[]) => {
    if (!selected || modelPending.current) return;
    const selectedIds = [...new Set(ids ?? session.selectedModelEvidenceIds)];
    const errors = previewInputErrors(selected.snapshot, selectedIds);
    if (errors.length) { setError(inputError(errors.join(" "))); return; }
    const imageIds = selectedIds.filter((id) => evidenceReadability(selected.snapshot, id).kind === "image");
    modelPending.current = true; modelCancelled.current = false; setModelStarting(true); setModelProgress(null); setError(null);
    let head = selected;
    let produced = false;
    const results: string[] = [];
    const failures: string[] = [];
    const step = async (kind: "标注" | "构件") => {
      setNotice("正在提取" + kind + (imageIds.length ? kind === "标注" ? "（1/2）" : "（2/2）" : ""));
      try {
        const outcome = kind === "标注"
          ? await modelRuns.runMeasurementTranscription(head, localActorId(), selectedIds, setModelProgress)
          : await modelRuns.runComponentRecognition(head, localActorId(), imageIds, setModelProgress);
        head = outcome.head; if (selectedProjectId.current === selected.projectId) setSelected(head);
        if (outcome.run?.status === "cancelled") {
          modelCancelled.current = true; results.push(kind + "提取已取消"); return;
        }
        if (outcome.run?.status === "failed") {
          results.push(kind + "提取失败"); failures.push(kind + "：本次提取未完成，运行记录已保留。"); return;
        }
        const output = outcome.candidate?.structured;
        const count = output?.kind === "measurementTranscription" ? output.dimensions.length : output?.kind === "componentRecognition" ? output.components.length : 0;
        produced ||= !!outcome.candidate;
        results.push(kind + "提取完成，" + count + " 条");
      } catch (reason) {
        const cancelled = modelCancelled.current || isCancelled(reason);
        if (cancelled) modelCancelled.current = true;
        results.push(kind + (cancelled ? "提取已取消" : "提取失败"));
        if (!cancelled) failures.push(kind + "：" + describeFailure(reason, kind + "提取失败").summaryZh);
        head = await projectRepository.getProjectHead(selected.projectId).catch(() => null) ?? head;
      } finally {
        const runs = await projectRepository.getProjectModelRuns(selected.projectId);
        if (selectedProjectId.current === selected.projectId) session.setProjectModelRuns(runs);
      }
    };
    try {
      await step("标注");
      if (imageIds.length && !modelCancelled.current && selectedProjectId.current === selected.projectId) await step("构件");
      else if (imageIds.length) results.push("构件提取未执行");
      if (selectedProjectId.current !== selected.projectId) return;
      if (produced) nav.setActiveStage("preview");
      setNotice(results.join("；") + "。已有结果保留，可继续核对或再次提取。");
      const evaluated = await workflow.evaluate(head, localActorId());
      if (produced || evaluated.revisionId !== selected.revisionId) setSelected(evaluated);
      if (failures.length) setError({ summaryZh: "预览处理未全部完成。" + failures.join("；"), nextStepZh: "已有部分可以继续核对；返回资料清单可再次提取，助手面板也提供单项读取入口。" });
      await refresh();
    } catch (reason) { setError(describeFailure(reason, "预览结果读取失败")); }
    finally { modelPending.current = false; setModelStarting(false); }
  };

  const cancelModel = () => { modelCancelled.current = true; void modelRuns.cancel(); };
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
    downloadProject, cancelExport, runModel, transcribeDrawings, generatePreview, cancelModel, resetModelProgress,
    jobProgressSummary,
  };
}

export type Jobs = ReturnType<typeof useJobs>;
