import type { ProjectHead, ProjectCommandService } from "@gujian/application";
import { AssetRecordSchema, ImageDerivativeSchema, ParseRecordSchema } from "@gujian/domain";
import { isTiff, parseEvidenceFile, sha256Hex, type IndexedDbProjectRepository } from "@gujian/infrastructure";

export interface ConvertedImage {
  base64: string; sourceSizePixels: [number, number]; derivedSizePixels: [number, number]; mode: string; pixelSha256: string;
}
const ERROR_DETAILS: Record<string, string> = {
  IMAGE_MULTIFRAME_UNSUPPORTED: "当前不支持多帧 TIFF，请分别提供单页图像。",
  IMAGE_MODE_UNSUPPORTED: "此图像模式无法保持像素生成 PNG，请补充可读单页图像。",
  IMAGE_FORMAT_UNSUPPORTED: "文件内容不是 TIFF，请核对原文件格式。",
  IMAGE_PIXELS_UNSUPPORTED: "图像超过 1.5 亿像素，当前处理未支持。",
  IMAGE_DECODE_FAILED: "原图无法解码，请核对或替换文件。",
  IMAGE_LOSSLESS_CHECK_FAILED: "派生图的像素保持检查未通过，请补充可读图像。",
  IMAGE_INPUT_TOO_LARGE: "派生图超过当前模型图像输入大小，请补充适合读取的单页图像。",
  IMAGE_PROCESSOR_UNAVAILABLE: "本机图像处理程序不可用，请启动服务后重试。",
  IMAGE_PROCESSING_TIMEOUT: "本机图像处理超时，请重试。",
  IMAGE_SERVICE_UNAVAILABLE: "本机服务未连接，请启动服务后重试。",
  IMAGE_SOURCE_HASH_MISMATCH: "原件哈希不匹配，请核对文件。",
};
export async function convertTiff(blob: Blob, fetchImpl: typeof fetch = fetch): Promise<ConvertedImage> {
  try {
    const sessionResponse = await fetchImpl("/api/session", { credentials: "same-origin" });
    if (!sessionResponse.ok) throw new Error("IMAGE_SERVICE_UNAVAILABLE");
    const session = await sessionResponse.json() as { csrfToken: string };
    const response = await fetchImpl("/api/evidence/process-image", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream", "x-csrf-token": session.csrfToken }, body: blob });
    const result = await response.json() as ConvertedImage & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "IMAGE_DECODE_FAILED");
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("IMAGE_")) throw error;
    throw new Error("IMAGE_SERVICE_UNAVAILABLE");
  }
}

export async function processStoredEvidence(input: {
  repository: IndexedDbProjectRepository; commands: ProjectCommandService; head: ProjectHead; actorId: string; evidenceId: string;
  convert?: (blob: Blob) => Promise<ConvertedImage>;
}): Promise<ProjectHead> {
  const { repository, commands, head, actorId, evidenceId } = input;
  const evidence = head.snapshot.evidences.find((item) => item.id === evidenceId);
  if (!evidence) throw new Error("EVIDENCE_NOT_FOUND");
  const original = await repository.getAsset(evidence.assetId);
  const file = new File([original.content], original.record.fileName, { type: original.record.mimeType });
  const now = new Date().toISOString();
  let derivative; let derivedAsset; let derivedBlob; let parse;
  try {
    if (sha256Hex(new Uint8Array(await original.content.arrayBuffer())) !== original.record.sha256) throw new Error("IMAGE_SOURCE_HASH_MISMATCH");
    if (isTiff(file)) {
      const result = await (input.convert ?? convertTiff)(original.content);
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
      if (bytes.length > 12 * 1024 * 1024 || bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) throw new Error("IMAGE_DECODE_FAILED");
      const assetId = crypto.randomUUID();
      derivative = ImageDerivativeSchema.parse({ assetId, originalSha256: original.record.sha256, sourceSizePixels: result.sourceSizePixels, derivedSizePixels: result.derivedSizePixels, mode: result.mode, pixelSha256: result.pixelSha256, coordinateMapping: "identity" });
      derivedBlob = new Blob([bytes], { type: "image/png" });
      derivedAsset = AssetRecordSchema.parse({ id: assetId, projectId: head.projectId, fileName: original.record.fileName.replace(/\.tiff?$/i, "") + ".derived.png", mimeType: "image/png", byteLength: bytes.length, sha256: sha256Hex(bytes), contentStatus: "available", createdAt: now });
      parse = { parser: "tiff-png", status: "metadataOnly" as const, extractedText: null, readability: "readable" as const, readableAs: "image" as const, warnings: [] };
    } else { parse = await parseEvidenceFile(file); }
  } catch (error) {
    derivative = undefined; derivedAsset = undefined; derivedBlob = undefined;
    const code = error instanceof Error ? error.message : "IMAGE_DECODE_FAILED";
    parse = { parser: isTiff(file) ? "tiff-png" : "file-read", status: "failed" as const, extractedText: null, readability: code.endsWith("_UNSUPPORTED") ? "unsupported" as const : "failed" as const, warnings: [ERROR_DETAILS[code] ?? "文件处理结果无效，请核对原件后重试。"] };
  }
  const parseRecord = ParseRecordSchema.parse({ ...parse, id: crypto.randomUUID(), projectId: head.projectId, assetId: evidence.assetId, evidenceId, parserVersion: "1.0.0", createdAt: now });
  const stagingSessionId = derivedAsset ? crypto.randomUUID() : undefined;
  if (derivedAsset && derivedBlob && stagingSessionId) await repository.stageAssets(stagingSessionId, [derivedAsset], new Map([[derivedAsset.id, derivedBlob]]));
  const { imageDerivative: oldDerivative, ...registration } = evidence;
  try {
    await commands.execute({ commandType: "ProcessEvidence", commandId: crypto.randomUUID(), projectId: head.projectId, actorId, expectedRevisionId: head.revisionId, issuedAt: now,
      payload: { evidence: { ...registration, ...(derivative || oldDerivative ? { imageDerivative: derivative ?? oldDerivative } : {}) }, parseRecord, ...(derivedAsset && stagingSessionId ? { derivedAsset, stagingSessionId } : {}) } });
  } catch (error) { if (stagingSessionId) await repository.cleanupStaging(stagingSessionId); throw error; }
  const saved = await repository.getProjectHead(head.projectId);
  if (!saved) throw new Error("PROJECT_NOT_FOUND");
  return saved;
}
