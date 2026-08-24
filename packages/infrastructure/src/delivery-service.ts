import { ProjectCommandService, type ProjectHead } from "@gujian/application";
import {
  ArtifactRecordSchema,
  DeliveryDraftSchema,
  DeliveryEvaluationSchema,
  type ArtifactRecord,
  type CheckRun,
  type DeliveryDraft,
  type DeliveryEvaluation,
  type GeometryRevision,
  type ReviewSignoff,
} from "@gujian/domain";
import { IndexedDbProjectRepository } from "./indexeddb-project-repository.js";
import { sha256Hex } from "./hash.js";

import { geometryPrerequisites } from "./geometry-spec-builder.js";

const GEOMETRY_KIND: Record<string, ArtifactRecord["kind"]> = {
  ifc: "ifc", glb: "glb", brepBundle: "brepBundle", manifest: "geometryManifest", sourceMap: "geometrySourceMap",
  report: "geometryReport", preview: "geometryPreview",
};

type DeliveryBlockerDetail = NonNullable<DeliveryEvaluation["blockerDetails"]>[number];
const FORMAL_ONLY_CODES = new Set(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", "L1_ELIGIBILITY_FALSE"]);

// 复核签发记录解除哪些正式资格阻断：复核与签发两条随记录解除，L1 只在记录认定达到样板等级时解除
export function signoffFor(head: ProjectHead, geometryRevisionId: string): ReviewSignoff | null {
  return head.snapshot.reviewSignoffs.find((item) => item.geometryRevisionId === geometryRevisionId) ?? null;
}

export function liftedBySignoff(signoff: ReviewSignoff | null): Set<string> {
  if (!signoff) return new Set();
  return new Set(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", ...(signoff.l1Eligible ? ["L1_ELIGIBILITY_FALSE"] : [])]);
}

// 签发是项目责任人员对正式资格的人工决定：只阻断正式资格、不阻断代理成果的项
// （未知项、未关闭的专业判断、检查里的复核要求）随签发一并视为已复核接受；
// 阻断代理成果本身的硬错误不受签发影响。L1 另按记录里的认定。
export function collectDeliveryBlockerDetails(head: ProjectHead, geometry: GeometryRevision, artifacts: readonly ArtifactRecord[], checkRun: CheckRun): DeliveryBlockerDetail[] {
  const details: DeliveryBlockerDetail[] = [];
  const signoff = signoffFor(head, geometry.id);
  const lifted = liftedBySignoff(signoff);
  const add = (detail: DeliveryBlockerDetail) => {
    if (lifted.has(detail.code) || lifted.has(detail.code.replace(/^CHECK_BLOCKED:/, ""))) return;
    if (signoff && !detail.blocksProxyOutcome && detail.code !== "L1_ELIGIBILITY_FALSE") return;
    if (!details.some((item) => item.code === detail.code && item.sourceRef === detail.sourceRef)) details.push(detail);
  };
  // 三条正式资格限制各有各的话，不合写成一句带内部码的判词
  const FORMAL_ONLY_ZH: Record<string, string> = {
    PROFESSIONAL_REVIEW_REQUIRED: "成果尚未经项目责任人员专业复核。",
    FORMAL_SIGNOFF_UNAVAILABLE: "本机身份不具备签发资格，签发须在正式环境完成。",
    L1_ELIGIBILITY_FALSE: "成果未评定为专业样板等级，不作为其他项目的参照标准。",
  };
  for (const code of FORMAL_ONLY_CODES) {
    add({ code, sourceType: "qualification", sourceRef: geometry.id, message: FORMAL_ONLY_ZH[code] ?? "成果尚未取得正式交付资格。", blocksProxyOutcome: false });
  }
  const spec = head.snapshot.geometrySpecs.find((item) => item.id === geometry.geometrySpecId);
  for (const unknown of spec?.unknowns ?? []) {
    add({ code: `UNKNOWN:${unknown.reasonCode}`, sourceType: "unknown", sourceRef: unknown.id, message: unknown.description, blocksProxyOutcome: unknown.blocksProxyOutcome });
  }
  for (const issue of head.snapshot.issues.filter((item) => item.status === "open")) {
    add({ code: `OPEN_ISSUE:${issue.issueType}:${issue.id}`, sourceType: "issue", sourceRef: issue.id, message: issue.description, blocksProxyOutcome: issue.blocksProxyOutcome });
  }
  for (const result of checkRun.results.filter((item) => item.outcome === "blocked")) {
    add({ code: `CHECK_BLOCKED:${result.code}`, sourceType: "check", sourceRef: checkRun.id, message: result.message, blocksProxyOutcome: !FORMAL_ONLY_CODES.has(result.code) });
  }
  const ARTIFACT_CODE_ZH: Record<string, string> = {
    PROFESSIONAL_REVIEW_REQUIRED: "尚未经专业复核",
    FORMAL_SIGNOFF_UNAVAILABLE: "不能由本机签发",
  };
  for (const artifact of artifacts) {
    for (const code of artifact.blockers) {
      add({ code, sourceType: "artifact", sourceRef: artifact.id, message: `成果文件 ${artifact.fileName} 在签发前${ARTIFACT_CODE_ZH[code] ?? "有未解除的限制"}。`, blocksProxyOutcome: !FORMAL_ONLY_CODES.has(code) });
    }
  }
  return details;
}

export class DeliveryService {
  constructor(private readonly input: { repository: IndexedDbProjectRepository; commands: ProjectCommandService }) {}

  async createProxyDraft(head: ProjectHead, actorId: string, geometry: GeometryRevision, drawingArtifacts: readonly ArtifactRecord[], checkRun: CheckRun): Promise<{ head: ProjectHead; draft: DeliveryDraft }> {
    let updated = head;
    const existingArtifacts = await this.input.repository.getProjectArtifacts(head.projectId);
    const existingIds = new Set(existingArtifacts.map((item) => item.assetId));
    const geometryArtifacts = geometry.assets.filter((asset) => !existingIds.has(asset.assetId)).map((asset) => ArtifactRecordSchema.parse({
      id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: geometry.projectRevisionId, geometryRevisionId: geometry.id,
      requirementMatrixId: null, kind: GEOMETRY_KIND[asset.kind]!, fileName: asset.kind === "brepBundle" ? "model-brep.zip" : `${asset.kind}.${asset.kind === "glb" ? "glb" : asset.kind === "ifc" ? "ifc" : asset.kind === "preview" ? "png" : asset.kind === "sourceMap" ? "ndjson" : "json"}`,
      assetId: asset.assetId, sha256: asset.sha256, mimeType: asset.mimeType, byteLength: asset.byteLength,
      status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, sourceRefs: [geometry.id],
      blockers: ["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE"], createdAt: new Date().toISOString(),
    }));
    if (geometryArtifacts.length) {
      await this.input.commands.execute({ commandType: "CommitArtifactSet", commandId: crypto.randomUUID(), projectId: head.projectId, actorId, expectedRevisionId: updated.revisionId, issuedAt: new Date().toISOString(), payload: { artifacts: geometryArtifacts, assets: [], stagingSessionId: null } });
      updated = (await this.input.repository.getProjectHead(head.projectId))!;
    }
    const persistedArtifacts = (await this.input.repository.getProjectArtifacts(head.projectId))
      .filter((item) => item.geometryRevisionId === geometry.id);
    const geometryAssetIds = new Set(geometry.assets.map((asset) => asset.assetId));
    const checkedDrawingIds = new Set(checkRun.artifactRefs);
    const allArtifacts = [
      ...geometryArtifacts,
      ...persistedArtifacts.filter((item) => geometryAssetIds.has(item.assetId)),
      ...drawingArtifacts.filter((item) => checkedDrawingIds.has(item.id)),
    ];
    const unique = [...new Map(allArtifacts.map((item) => [item.id, item])).values()];
    const blockerDetails = collectDeliveryBlockerDetails(updated, geometry, unique, checkRun);
    const blockerCodes = [...new Set(blockerDetails.map((item) => item.code))];
    const blocksProxy = blockerDetails.some((item) => item.blocksProxyOutcome);
    const evaluation = DeliveryEvaluationSchema.parse({
      id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: updated.revisionId, geometryRevisionId: geometry.id,
      artifactRefs: unique.map((item) => item.id), checkRunRefs: [checkRun.id], outcome: blocksProxy ? "blocked" : "proxy-ready",
      blockerCodes, blockerDetails, formalEligibility: false, evaluatedAt: new Date().toISOString(),
    });
    await this.input.commands.execute({ commandType: "EvaluateDelivery", commandId: crypto.randomUUID(), projectId: head.projectId, actorId, expectedRevisionId: updated.revisionId, issuedAt: evaluation.evaluatedAt, payload: { evaluation } });
    updated = (await this.input.repository.getProjectHead(head.projectId))!;
    if (blocksProxy) throw new Error(`DELIVERY_PROXY_BLOCKED:${blockerCodes.join(",")}`);

    const manifestPayload = {
      schemaVersion: "1.0", projectId: head.projectId, projectRevisionId: updated.revisionId, geometryRevisionId: geometry.id,
      status: "proxy-unissued", qualification: "generated-not-qualified", l1Eligible: false, formalEligibility: false,
      artifacts: unique.map((item) => ({ artifactId: item.id, kind: item.kind, assetId: item.assetId, fileName: item.fileName, sha256: item.sha256, byteLength: item.byteLength })),
      blockers: evaluation.blockerCodes,
      blockerDetails,
    };
    const bytes = new TextEncoder().encode(`${JSON.stringify(manifestPayload, null, 2)}\n`);
    const manifestAsset = {
      id: crypto.randomUUID(), projectId: head.projectId, fileName: "delivery-manifest.json", mimeType: "application/json",
      byteLength: bytes.byteLength, sha256: sha256Hex(bytes), contentStatus: "available" as const, createdAt: new Date().toISOString(),
    };
    const sessionId = crypto.randomUUID();
    await this.input.repository.stageAssets(sessionId, [manifestAsset], new Map([[manifestAsset.id, new Blob([bytes as BlobPart], { type: manifestAsset.mimeType })]]));
    const manifestArtifact = ArtifactRecordSchema.parse({
      id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: updated.revisionId, geometryRevisionId: geometry.id,
      requirementMatrixId: null, kind: "deliveryManifest", fileName: manifestAsset.fileName, assetId: manifestAsset.id,
      sha256: manifestAsset.sha256, mimeType: manifestAsset.mimeType, byteLength: manifestAsset.byteLength,
      status: "generated-not-qualified", l1Eligible: false, formalEligibility: false, sourceRefs: [evaluation.id],
      blockers: evaluation.blockerCodes, createdAt: manifestAsset.createdAt,
    });
    const draft = DeliveryDraftSchema.parse({
      id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: updated.revisionId, geometryRevisionId: geometry.id,
      evaluationId: evaluation.id, artifactRefs: [...unique.map((item) => item.id), manifestArtifact.id], manifestAssetId: manifestAsset.id,
      manifestHash: manifestAsset.sha256, status: "proxy-unissued", l1Eligible: false, formalEligibility: false, signatureStatus: "unsigned",
      // 限制条款写给读档案的人：整句中文，逐文件重复的成果限制合并成一条带件数的说明
      restrictions: [
        "本套成果由系统生成，签发前只作为待签发成果使用。",
        "签发前不可用于正式交付、施工或法定档案入库。",
        "签发前须经项目责任人员专业复核。",
        ...(() => {
          const merged = new Map<string, number>();
          for (const item of blockerDetails) {
            const key = item.sourceType === "artifact" ? item.message.replace(/^成果文件 .+ 在签发前/, "成果文件在签发前") : item.message;
            merged.set(key, (merged.get(key) ?? 0) + 1);
          }
          return [...merged.entries()].map(([text, count]) => (count > 1 ? `${text}（涉及 ${count} 项）` : text));
        })().slice(0, 96),
      ], createdAt: manifestAsset.createdAt,
    });
    await this.input.commands.execute({ commandType: "CreateDeliveryDraft", commandId: crypto.randomUUID(), projectId: head.projectId, actorId, expectedRevisionId: updated.revisionId, issuedAt: draft.createdAt, payload: { draft, manifestAsset, manifestArtifact, stagingSessionId: sessionId } });
    return { head: (await this.input.repository.getProjectHead(head.projectId))!, draft };
  }

  blockers(head: ProjectHead): string[] {
    // 几何版本已经建出来，说明构件事实已随几何规格入库，前置事实不再算缺
    const missing = head.snapshot.geometryRevisions.length ? [] : geometryPrerequisites(head).missing.map((field) => `缺少已确认事实或任务要求：${field}`);
    const open = head.snapshot.issues.filter((item) => item.status === "open").map((item) => item.description);
    return [...missing, ...open];
  }

  async recordBlockedEvaluation(head: ProjectHead, actorId: string): Promise<DeliveryEvaluation> {
    const messages = this.blockers(head);
    if (!messages.length) throw new Error("DELIVERY_NOT_BLOCKED");
    const openIssues = head.snapshot.issues.filter((item) => item.status === "open");
    const blockerDetails: DeliveryBlockerDetail[] = messages.map((message, index) => ({
      code: `PROJECT_INPUT_BLOCKED:${index + 1}`,
      sourceType: message.startsWith("缺少已确认") ? "fact" : "issue",
      sourceRef: openIssues.find((item) => item.description === message)?.id ?? head.projectId,
      message,
      blocksProxyOutcome: true,
    }));
    const evaluation = DeliveryEvaluationSchema.parse({
      id: crypto.randomUUID(), projectId: head.projectId, projectRevisionId: head.revisionId,
      geometryRevisionId: head.snapshot.geometryRevisions.at(-1)?.id ?? null,
      artifactRefs: [], checkRunRefs: [], outcome: "blocked", blockerCodes: blockerDetails.map((item) => item.code), blockerDetails,
      formalEligibility: false, evaluatedAt: new Date().toISOString(),
    });
    await this.input.commands.execute({
      commandType: "EvaluateDelivery", commandId: crypto.randomUUID(), projectId: head.projectId,
      actorId, expectedRevisionId: head.revisionId, issuedAt: evaluation.evaluatedAt, payload: { evaluation },
    });
    return evaluation;
  }
}
