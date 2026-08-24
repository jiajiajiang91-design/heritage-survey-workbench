import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ProjectHead } from "@gujian/application";
import { ArchetypeSpecSchema, type ArtifactRecord, type TaskArtifactRequirements } from "@gujian/domain";
import {
  IndexedDbProjectRepository, ProjectPackageService, deriveArchetypeExpectations, openWorkbenchDatabase,
} from "@gujian/infrastructure";

import { AssistantExecutors } from "../assistant/action-executors";
import { commitDocumentedDimensionChain } from "../document-dimension-service";
import { describeFailure, inputError } from "../failure-notice";
import { commitGeometryFacts } from "../geometry-fact-service";
import {
  evidenceIngestion, localActorId, deliveries, projectCommands, projectPackages, projectRepository, workflow,
} from "../workbench";
import { triggerDownload } from "./download";
import type { Notices } from "./useNotices";
import type { ProjectSession } from "./useProjectSession";

// 恢复检验用的独立数据库，与本机项目库分开，用完即删
const ROUNDTRIP_VERIFY_DB = "gujian-roundtrip-verify";

export interface RoundTripReceipt {
  jsonSha256: string;
  jsonBytes: number;
  jsonEvidenceCount: number;
  jsonMissingAssetCount: number;
  zipSha256: string;
  zipBytes: number;
  projectId: string;
  sourceRevisionId: string;
  importedRevisionId: string;
  evidenceCount: number;
  ruleRunCount: number;
  decisionCount: number;
  geometryRevisionCount: number;
  artifactCount: number;
  checkRunCount: number;
  deliveryCount: number;
}

type Candidate = ProjectHead["snapshot"]["candidates"][number];

export interface TaskSetupValues {
  taskName: string;
  scope: string[];
  regulationRefs: string[];
  deliverables: string[];
  artifactRequirements: TaskArtifactRequirements;
}

// 表单到任务书取值。分隔符沿用旧表单：逗号、中文逗号或换行。
export function readTaskSetupForm(data: FormData): TaskSetupValues {
  const split = (value: FormDataEntryValue | null) => String(value ?? "").split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
  return {
    taskName: String(data.get("taskName") ?? "").trim(),
    scope: split(data.get("scope")),
    regulationRefs: split(data.get("regulations")),
    deliverables: split(data.get("deliverables")),
    // 图幅与视图由后端 schema 校验，这里只做解析，不替它们把关
    artifactRequirements: {
      titleZh: String(data.get("drawingTitle") ?? "").trim(),
      revisionLabel: String(data.get("drawingRevision") ?? "").trim(),
      geometryTargetRoles: split(data.get("geometryTargetRoles")),
      sheets: JSON.parse(String(data.get("drawingSheets") ?? "[]")),
      views: JSON.parse(String(data.get("drawingViews") ?? "[]")),
    } as TaskArtifactRequirements,
  };
}

interface WriteDeps {
  session: ProjectSession;
  notices: Notices;
}

// 一切写入项目的人工操作。每个函数写完都重读项目或更新头，组件不自己改快照。
export function useRecordWrites({ session, notices }: WriteDeps) {
  const { setError, setNotice } = notices;
  const { selected, setSelected, refresh, loadProject, confirmedTask } = session;
  const [roundTripReceipt, setRoundTripReceipt] = useState<RoundTripReceipt | null>(null);
  const assistantExecutors = useMemo(
    () => new AssistantExecutors({ commands: projectCommands, workflow, actorId: localActorId }),
    [],
  );

  // 项目版本一变，上一次的恢复检验结果就不再代表当前状态
  useEffect(() => { setRoundTripReceipt(null); }, [selected?.projectId, selected?.revisionId]);

  const confirmGeometryFacts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    try {
      const head = await commitGeometryFacts({
        head: selected, actorId: localActorId(), repository: projectRepository, commands: projectCommands,
        values: {
          components: JSON.parse(String(data.get("geometryComponents") ?? "[]")),
          interfaces: JSON.parse(String(data.get("geometryInterfaces") ?? "[]")),
        },
      });
      setSelected(head); await refresh(); setNotice("控制尺寸已作为人工确认的尺寸写入；来源仍指向本项目资料");
    } catch (reason) { setError(describeFailure(reason, "控制尺寸确认失败")); }
  };

  const createProxyDelivery = async () => {
    const { geometryRevision, latestCheckRun, drawingArtifacts } = session;
    if (!selected || !geometryRevision || !latestCheckRun || !drawingArtifacts.length) return;
    setError(null);
    try {
      const outcome = await deliveries.createProxyDraft(selected, localActorId(), geometryRevision, drawingArtifacts, latestCheckRun);
      setSelected(outcome.head); await loadProject(selected.projectId); await refresh(); setNotice("交付草案已建立。尚未签发，不能用于正式交付或施工");
    } catch (reason) { setError(describeFailure(reason, "归档草案建立失败")); }
  };

  const recordBlockedDelivery = async () => {
    if (!selected) return;
    setError(null);
    try {
      await deliveries.recordBlockedEvaluation(selected, localActorId());
      await loadProject(selected.projectId);
      await refresh();
      setNotice("已记录本次无法正式交付的原因。系统没有生成空成果，也没有用默认数据补齐");
    } catch (reason) { setError(describeFailure(reason, "记录失败")); }
  };

  const downloadArtifact = async (artifact: ArtifactRecord) => {
    const asset = await projectRepository.getAsset(artifact.assetId);
    triggerDownload(asset.content, artifact.fileName);
  };

  const registerArchetype = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const splitDims = (name: string) => String(data.get(name) ?? "").split(/[，,\s]+/).filter(Boolean);
    try {
      const commandId = crypto.randomUUID();
      const archetypeSpec = ArchetypeSpecSchema.parse({
        id: crypto.randomUUID(),
        projectId: selected.projectId,
        buildingRef: selected.snapshot.buildings[0]!.id,
        baseParams: { D: String(data.get("baseD") ?? "300") },
        bayDimensions: [
          { direction: "x", valuesMm: splitDims("bayX") },
          { direction: "y", valuesMm: splitDims("bayY") },
        ],
        liftRatioSetRef: String(data.get("liftRatioSetRef") || "qing-gongcheng-zuofa"),
        stepCount: Number(data.get("stepCount")),
        pillarNet: String(data.get("pillarNet") ?? "").trim(),
        fangNet: String(data.get("fangNet") ?? "").trim() || null,
        sourceDeclaration: String(data.get("sourceDeclaration") ?? "").trim() || "形制判断，来源未注明",
        producer: { producerType: "human", actorId: localActorId(), actionRef: { commandId } },
        createdAt: new Date().toISOString(),
      });
      await projectCommands.execute({
        commandType: "CommitArchetypeSpec", commandId, projectId: selected.projectId, actorId: localActorId(),
        expectedRevisionId: selected.revisionId, issuedAt: archetypeSpec.createdAt,
        payload: { archetypeSpec },
      });
      // 应然值派生留痕：派生结果作为规则运行记录（producer=rule），含计算值、容差与出处
      const afterSpec = await projectRepository.getProjectHead(selected.projectId);
      const derivation = deriveArchetypeExpectations(archetypeSpec);
      const ruleRunId = crypto.randomUUID();
      const derivedAt = new Date().toISOString();
      await projectCommands.execute({
        commandType: "CommitRuleEvaluation", commandId: crypto.randomUUID(), projectId: selected.projectId,
        actorId: localActorId(), expectedRevisionId: afterSpec!.revisionId, issuedAt: derivedAt,
        payload: {
          ruleRun: {
            id: ruleRunId, projectId: selected.projectId, inputRevisionId: afterSpec!.revisionId,
            ruleSetVersion: derivation.ruleSetVersion, status: "completed",
            producer: { producerType: "rule", ruleRunId },
            results: derivation.expected.map((item) => ({
              ruleId: `archetype-expected-${item.dimension}`,
              outcome: "passed" as const,
              inputRefs: [archetypeSpec.id],
              issueRefs: [],
              message: item.status === "computed"
                ? `应然 ${item.dimension} ${item.valueMm} mm（不覆盖实测，不作正式标注依据）`
                : `应然 ${item.dimension} 按实计，无实测记录时保持未知`,
              ...(item.valueMm !== null ? { computedValueText: `${item.valueMm} mm` } : {}),
              ...(item.toleranceText ? { toleranceText: item.toleranceText } : {}),
              sourceText: item.sourceText,
            })),
            startedAt: derivedAt, completedAt: derivedAt,
          },
          issues: [],
        },
      });
      await loadProject(selected.projectId);
      setNotice("形制模板已登记，应然值派生完成并入规则运行记录");
    } catch (reason) {
      setError(describeFailure(reason, "形制模板登记失败"));
    }
  };

  const uploadEvidenceFiles = async (files: readonly File[]) => {
    if (!selected) return;
    setError(null);
    try {
      let current = selected;
      for (const file of files) {
        const updated = await evidenceIngestion.ingest(current, localActorId(), file);
        current = await workflow.evaluate(updated, localActorId());
      }
      setSelected(current);
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(current.projectId));
      await refresh();
      setNotice(files.length === 1
        ? `资料“${files[0]!.name}”已保存并建立来源关系`
        : `${files.length} 份原始资料已保存并逐份建立来源关系`);
    } catch (reason) {
      setError(describeFailure(reason, "资料上传失败"));
    }
  };

  // 确认后把读准的尺寸写成事实。来源标为实测转录并注明取自哪份资料，
  // producer 为 human：数值出自模型，采信与否是人的决定。
  const confirmTranscribedDimensions = async (candidate: Candidate) => {
    if (!selected || candidate.structured?.kind !== "measurementTranscription") return;
    const rows = candidate.structured.dimensions.filter((item) => item.certainty === "certain" && item.valueMm);
    if (!rows.length) {
      setError(inputError("这条结果里没有可直接写入的尺寸。读不准的条目需要先人工核实原图。"));
      return;
    }
    setError(null);
    try {
      const at = new Date().toISOString();
      await projectCommands.execute({
        commandType: "CommitFacts",
        commandId: crypto.randomUUID(),
        projectId: selected.projectId,
        actorId: localActorId(),
        expectedRevisionId: selected.revisionId,
        issuedAt: at,
        payload: {
          facts: rows.map((row, index) => ({
            id: crypto.randomUUID(),
            subjectRef: selected.snapshot.buildings[0]?.id ?? selected.projectId,
            field: `documentedDimension.transcribed${index + 1}`,
            value: {
              name: row.partZh ?? "未定名尺寸",
              value: Number(row.valueMm),
              unit: "mm",
              methodZh: `转写自${session.evidenceTitle(row.evidenceRef)}${row.locationZh ? ` ${row.locationZh}` : ""}标注 ${row.valueText}`,
            },
            producer: { producerType: "human" as const, actorId: localActorId() },
            evidenceRefs: [row.evidenceRef],
            reviewStatus: "confirmed" as const,
            dataStatus: "available" as const,
          })),
        },
      });
      await loadProject(selected.projectId);
      await refresh();
      setNotice(`已写入 ${rows.length} 条尺寸，来源标为实测转录`);
    } catch (reason) {
      setError(describeFailure(reason, "尺寸写入失败"));
    }
  };

  // 识别出的构件确认后写成构件记录。只写模型标为确定的那些：标了不确定的
  // 由人逐条核实，不由模型替人决定哪条能进项目。这与尺寸转写同一条口径。
  const confirmRecognizedComponents = async (candidate: Candidate) => {
    if (!selected || candidate.structured?.kind !== "componentRecognition") return;
    const rows = candidate.structured.components.filter((item) => item.certainty === "certain");
    if (!rows.length) {
      setError(inputError("这条结果里没有标为确定的构件。标了不确定的需要先人工核实原图。"));
      return;
    }
    setError(null);
    try {
      const outcome = await assistantExecutors.commitRecognizedComponents(selected, rows.map((row) => ({
        nameZh: row.nameZh,
        categoryZh: row.categoryZh,
        evidenceRef: row.evidenceRef,
        region: row.region,
      })));
      if (outcome.kind === "rejected") {
        setError(inputError(outcome.reasonZh ?? "构件写入未执行"));
        return;
      }
      await loadProject(selected.projectId);
      await refresh();
      setNotice(outcome.messageZh ?? `已写入 ${rows.length} 个构件记录`);
    } catch (reason) {
      setError(describeFailure(reason, "构件写入失败"));
    }
  };

  // 任务要求：第一次确认与后续换版走同一个入口。已有确认过的任务时建新版本，
  // 旧任务定义保留在审计链中。
  const submitTaskSetup = async (values: TaskSetupValues) => {
    if (!selected) return;
    const replacing = confirmedTask !== null;
    try {
      const updated = replacing
        ? await workflow.replaceTaskDefinition(selected, localActorId(), values)
        : await workflow.confirmTaskSetup(selected, localActorId(), values);
      setSelected(updated);
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(selected.projectId));
      await refresh();
      setNotice(replacing ? "任务成果要求已建立新版本；旧任务定义保留在审计链中。" : "任务范围、规范和责任角色已一次确认");
    } catch (reason) {
      setError(describeFailure(reason, replacing ? "任务成果要求更新失败" : "任务设置失败"));
    }
  };

  const decideCandidate = async (issueId: string, candidateId: string, outcome: "accepted" | "rejected", typedReason: string): Promise<boolean> => {
    if (!selected) return false;
    if (outcome === "rejected" && !typedReason.trim()) {
      setError(inputError("驳回候选时需要填写理由"));
      return false;
    }
    try {
      const updated = await workflow.decideCandidate(selected, localActorId(), {
        candidateId,
        issueId,
        outcome,
        reason: outcome === "accepted"
          ? "接受为已核对的识别结果；不转为现场实测记录。"
          : typedReason.trim(),
      });
      setSelected(updated);
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(selected.projectId));
      session.setProjectDecisions(await projectRepository.getProjectDecisions(selected.projectId));
      await refresh();
      setNotice(outcome === "accepted" ? "候选已接受，仍保持模型来源" : "候选已驳回并记录理由");
      return true;
    } catch (reason) {
      setError(describeFailure(reason, "候选处理失败"));
      return false;
    }
  };

  const decideIssueOption = async (issueId: string, outcome: "accepted" | "rejected", selectedOptionId: string | null, typedReason: string): Promise<boolean> => {
    if (!selected) return false;
    const reason = typedReason.trim();
    if (outcome === "accepted" && !selectedOptionId) {
      setError(inputError("请先选择一个方案再确认"));
      return false;
    }
    if (outcome === "rejected" && !reason) {
      setError(inputError("暂不选择时需要填写理由"));
      return false;
    }
    try {
      const updated = await workflow.decideIssueOption(selected, localActorId(), {
        issueId, outcome, selectedOptionId, reason: reason || null,
      });
      setSelected(updated);
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(selected.projectId));
      session.setProjectDecisions(await projectRepository.getProjectDecisions(selected.projectId));
      setNotice(outcome === "accepted" ? "方案已选定并记录出处，问题关闭" : "已记录暂不选择的理由");
      return true;
    } catch (failure) {
      setError(describeFailure(failure, "方案决定失败"));
      return false;
    }
  };

  // 现状记录（05 表 2）：人工判断必须绑定资料，无证据不允许记录
  const recordObservation = async (values: { observationType: string; subjectRef: string; evidenceRef: string; text: string }): Promise<boolean> => {
    if (!selected) return false;
    const evidenceRef = values.evidenceRef.trim();
    if (!evidenceRef) { setError(inputError("现状记录必须指向一份项目资料")); return false; }
    const commandId = crypto.randomUUID();
    try {
      await projectCommands.execute({
        commandType: "CommitObservations",
        commandId, projectId: selected.projectId, actorId: localActorId(),
        expectedRevisionId: selected.revisionId, issuedAt: new Date().toISOString(),
        payload: { observations: [{
          id: crypto.randomUUID(),
          subjectRef: values.subjectRef.trim() || selected.snapshot.buildings[0]!.id,
          observationType: (values.observationType || "visibleCondition") as "visibleCondition" | "material" | "damage" | "state",
          text: values.text.trim(),
          producer: { producerType: "human", actorId: localActorId(), actionRef: { commandId } },
          evidenceRefs: [evidenceRef],
          dataStatus: "available",
        }] },
      });
      const head = await projectRepository.getProjectHead(selected.projectId);
      if (head) setSelected(await workflow.evaluate(head, localActorId()));
      setNotice("现状记录已写入当前版本，来源指向所选资料");
      return true;
    } catch (reason) {
      setError(describeFailure(reason, "现状记录写入失败"));
      return false;
    }
  };

  const confirmDocumentedDimensionChain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const segmentWidthsMm = String(data.get("segmentWidthsMm") ?? "")
      .split(/[，,\s]+/).map(Number).filter((value) => Number.isFinite(value));
    try {
      const committed = await commitDocumentedDimensionChain({
        head: selected, actorId: localActorId(), repository: projectRepository, commands: projectCommands,
        totalWidthMm: Number(data.get("totalWidthMm")), segmentWidthsMm,
        measurementMetadataComplete: data.get("measurementMetadataComplete") === "on",
        evidenceRefs: selected.snapshot.evidences.map((item) => item.id),
      });
      const evaluated = await workflow.evaluate(committed, localActorId());
      setSelected(evaluated);
      session.setProjectRuleRuns(await projectRepository.getProjectRuleRuns(selected.projectId));
      await refresh();
      setNotice("文档尺寸链已转写，规则已自动核对差值和测量元数据");
    } catch (reason) {
      setError(describeFailure(reason, "尺寸链转写失败"));
    }
  };

  const verifyEmptyLibraryRoundTrip = async () => {
    if (!selected) return;
    setError(null);
    setRoundTripReceipt(null);
    let verifyDatabase: IDBDatabase | null = null;
    const expected = {
      projectId: selected.projectId,
      revisionId: selected.revisionId,
      evidenceIds: selected.snapshot.evidences.map((item) => item.id).sort(),
      assetIds: selected.snapshot.evidences.map((item) => item.assetId).sort(),
      geometryRevisionIds: selected.snapshot.geometryRevisions.map((item) => item.id).sort(),
      artifactIds: session.projectArtifacts.map((item) => item.id).sort(),
      checkRunIds: session.projectCheckRuns.map((item) => item.id).sort(),
      deliveryIds: session.projectDeliveries.map((item) => item.id).sort(),
    };
    try {
      const [jsonBytes, zipBytes] = await Promise.all([
        projectPackages.exportJson(selected.projectId),
        projectPackages.exportZip(selected.projectId),
      ]);
      const sha256 = async (bytes: Uint8Array) => {
        const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
      };
      const [jsonSha256, zipSha256] = await Promise.all([sha256(jsonBytes), sha256(zipBytes)]);
      // JSON 只校验不落库；只有 ZIP 走空库恢复。
      const parsedJson = projectPackages.parseWithContents(jsonBytes, "roundtrip.project.json");
      const jsonData = parsedJson.data;
      const jsonMissingAssetCount = jsonData.assets.filter((asset) => asset.contentStatus === "missing").length;
      if (
        jsonData.snapshot.project.id !== expected.projectId
        || jsonData.sourceRevision.id !== expected.revisionId
        || jsonData.snapshot.evidences.length !== expected.evidenceIds.length
        || jsonMissingAssetCount !== jsonData.assets.length
        || parsedJson.contents.size !== 0
      ) {
        throw new Error("JSON_ROUNDTRIP_IDENTITY_MISMATCH");
      }

      const parsedZip = projectPackages.parseWithContents(zipBytes, "roundtrip.gujian.zip");
      if (
        parsedZip.data.snapshot.project.id !== expected.projectId
        // 标为可用的资料必须带回原件；登记时就没有原件的资料不该凭空多出内容。
        || parsedZip.contents.size !== parsedZip.data.assets.filter((asset) => asset.contentStatus === "available").length
      ) {
        throw new Error("ZIP_ROUNDTRIP_ASSET_CONTENT_MISSING");
      }

      // 恢复检验在独立数据库进行，本机项目库全程只读，不受影响
      verifyDatabase = await openWorkbenchDatabase(ROUNDTRIP_VERIFY_DB);
      const verifyRepository = new IndexedDbProjectRepository(verifyDatabase);
      const verifyPackages = new ProjectPackageService(verifyRepository);
      const importedProjectId = await verifyPackages.import(zipBytes, "roundtrip.gujian.zip", localActorId());
      const importedHead = await verifyRepository.getProjectHead(importedProjectId);
      if (!importedHead) throw new Error("ROUNDTRIP_PROJECT_MISSING");
      const importedEvidenceIds = importedHead.snapshot.evidences.map((item) => item.id).sort();
      const importedAssetIds = importedHead.snapshot.evidences.map((item) => item.assetId).sort();
      const importedArtifacts = await verifyRepository.getProjectArtifacts(importedProjectId);
      const importedChecks = await verifyRepository.getProjectCheckRuns(importedProjectId);
      const importedDeliveries = await verifyRepository.getProjectDeliveries(importedProjectId);
      if (
        importedHead.projectId !== expected.projectId
        || !importedHead.snapshot.adoptedRecordRefs.some((ref) => ref.startsWith("revision:"))
        || JSON.stringify(importedEvidenceIds) !== JSON.stringify(expected.evidenceIds)
        || JSON.stringify(importedAssetIds) !== JSON.stringify(expected.assetIds)
        || JSON.stringify(importedHead.snapshot.geometryRevisions.map((item) => item.id).sort()) !== JSON.stringify(expected.geometryRevisionIds)
        || JSON.stringify(importedArtifacts.map((item) => item.id).sort()) !== JSON.stringify(expected.artifactIds)
        || JSON.stringify(importedChecks.map((item) => item.id).sort()) !== JSON.stringify(expected.checkRunIds)
        || JSON.stringify(importedDeliveries.map((item) => item.id).sort()) !== JSON.stringify(expected.deliveryIds)
      ) {
        throw new Error("ROUNDTRIP_IDENTITY_MISMATCH");
      }
      const [rules, decisions] = await Promise.all([
        verifyRepository.getProjectRuleRuns(importedProjectId),
        verifyRepository.getProjectDecisions(importedProjectId),
      ]);
      const importedAssets = await verifyRepository.getProjectAssets(importedProjectId);
      const expectedAvailableAssetIds = new Set(
        (await projectRepository.getProjectAssets(selected.projectId))
          .filter(({ record }) => record.contentStatus === "available").map(({ record }) => record.id),
      );
      const assetStateWrong = importedAssets.some(({ record, content }) => expectedAvailableAssetIds.has(record.id)
        ? record.contentStatus !== "available" || content === null
        : record.contentStatus !== "missing");
      if (assetStateWrong) throw new Error("ZIP_ROUNDTRIP_ASSET_CONTENT_MISSING");
      setRoundTripReceipt({
        jsonSha256,
        jsonBytes: jsonBytes.byteLength,
        jsonEvidenceCount: jsonData.snapshot.evidences.length,
        jsonMissingAssetCount,
        zipSha256,
        zipBytes: zipBytes.byteLength,
        projectId: importedProjectId,
        sourceRevisionId: expected.revisionId,
        importedRevisionId: importedHead.revisionId,
        evidenceCount: importedHead.snapshot.evidences.length,
        ruleRunCount: rules.length,
        decisionCount: decisions.length,
        geometryRevisionCount: importedHead.snapshot.geometryRevisions.length,
        artifactCount: importedArtifacts.length,
        checkRunCount: importedChecks.length,
        deliveryCount: importedDeliveries.length,
      });
      setNotice("检验通过：导出的项目在独立环境中完整恢复，本机项目未改动");
    } catch (reason) {
      setError(describeFailure(reason, "导出与恢复检验未通过"));
    } finally {
      // 验证库用完即删，失败路径同样清理，不留残库
      verifyDatabase?.close();
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(ROUNDTRIP_VERIFY_DB);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
  };

  return {
    assistantExecutors, roundTripReceipt,
    confirmGeometryFacts, createProxyDelivery, recordBlockedDelivery, downloadArtifact, registerArchetype,
    uploadEvidenceFiles, confirmTranscribedDimensions, confirmRecognizedComponents, submitTaskSetup,
    decideCandidate, decideIssueOption, recordObservation, confirmDocumentedDimensionChain, verifyEmptyLibraryRoundTrip,
  };
}

export type RecordWrites = ReturnType<typeof useRecordWrites>;
