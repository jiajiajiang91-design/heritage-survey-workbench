import { ProjectCommandService, type ProjectHead } from "@gujian/application";
import { AssetRecordSchema, EvidenceSchema, ParseRecordSchema, type AssetRecord } from "@gujian/domain";

import { sha256Hex } from "./hash.js";
import { IndexedDbProjectRepository, LocalAuthorization } from "./indexeddb-project-repository.js";

export interface UploadFile extends Blob {
  readonly name: string;
  readonly lastModified?: number;
}

export function isTiff(file: { name: string; type: string }): boolean { return /\.tiff?$/i.test(file.name) || file.type === "image/tiff"; }

const TEXT_LIMIT = 200_000;

function evidenceType(file: UploadFile): "photo" | "document" | "drawing" | "audio" | "video" | "other" {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (["dwg", "dxf", "svg"].includes(extension)) return "drawing";
  if (["pdf", "doc", "docx", "txt", "md", "json", "csv"].includes(extension) || file.type.startsWith("text/")) return "document";
  return "other";
}

export interface ParseOutcome {
  parser: string;
  status: "parsed" | "metadataOnly" | "pending" | "failed";
  extractedText: string | null;
  warnings: string[];
  readability?: "readable" | "unsupported" | "failed";
  readableAs?: "text" | "image";
}

// PDF 逐页取文字层。任务书、历史记录、修缮档案都是 PDF，用户旅程第一步
// 用户拖进来的就是任务书，因此这是常规入口不是特例。
//
// 解析器按需导入：PDF 上传是低频动作，为它常驻一兆多的解析器不合算。
async function parsePdf(file: UploadFile): Promise<ParseOutcome> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof Worker !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.mjs?v=${pdfjs.version}-mime1`;
    // 不允许求值、不取系统字体：解析的是不可信来源，只要文字内容
    const document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: false,
      disableFontFace: true,
    }).promise;
    const pages: string[] = [];
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    const text = pages.join("\n").replace(/[ \t]+/g, " ").trim();
    if (!text) {
      // 纯扫描件没有文字层。如实说明缺什么，不返回空字符串装作解析成功。
      return {
        parser: "pdf-text",
        readability: "unsupported",
        status: "metadataOnly",
        extractedText: null,
        warnings: [`该 PDF 共 ${document.numPages} 页但没有文字层，需要 OCR 或人工转录后才能作为文字依据；原文件已保存。`],
      };
    }
    const truncated = text.length > TEXT_LIMIT;
    return {
      parser: "pdf-text",
      readability: "readable", readableAs: "text",
      status: "parsed",
      extractedText: text.slice(0, TEXT_LIMIT),
      warnings: [
        `已从 ${document.numPages} 页取出文字层。扫描件的文字层由 OCR 生成，可能有错字与断字，引用前需核对原件。`,
        ...(truncated ? [`提取文本已按 ${TEXT_LIMIT} 字符上限截断；原文件未截断。`] : []),
      ],
    };
  } catch (reason) {
    return {
      parser: "pdf-text",
      readability: "failed",
      status: "failed",
      extractedText: null,
      warnings: ["PDF 读取失败，请核对原件并重试；原文件仍已保存。"],
    };
  }
}

export async function parseEvidenceFile(file: UploadFile): Promise<ParseOutcome> {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";
  if (extension === "pdf" || file.type === "application/pdf") return parsePdf(file);
  if (isTiff(file)) return { parser: "tiff-png", status: "pending", extractedText: null, readability: "unsupported", warnings: ["TIFF 原件已保存，需要本机图像处理后才能用于提取。"] };
  if (["image/png", "image/jpeg", "image/webp"].includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    try {
      if (file.size > 12 * 1024 * 1024) return { parser: "image-decode", status: "metadataOnly", extractedText: null, readability: "unsupported", warnings: ["图像超过当前单份模型输入 12 MiB 上限；原件已保存，请补充适合读取的图像。"] };
      if (typeof createImageBitmap !== "function") return { parser: "image-decode", status: "pending", extractedText: null, readability: "unsupported", warnings: ["当前环境不能解码图像，请在浏览器中重试读取。"] };
      const bitmap = await createImageBitmap(file);
      const valid = bitmap.width > 0 && bitmap.height > 0; bitmap.close();
      if (!valid) throw new Error("EMPTY_IMAGE");
      return { parser: "image-decode", status: "metadataOnly", extractedText: null, readability: "readable", readableAs: "image", warnings: [] };
    } catch { return { parser: "image-decode", status: "failed", extractedText: null, readability: "failed", warnings: ["图像无法解码，请核对或替换原文件。"] }; }
  }
  const textLike = file.type.startsWith("text/") || ["txt", "md", "json", "csv", "xml"].includes(extension);
  if (!textLike) {
    return {
      parser: "binary-metadata",
      readability: "unsupported",
      status: ["dwg", "dxf"].includes(extension) ? "pending" : "metadataOnly",
      extractedText: null,
      warnings: ["原始文件已保存，当前提取未支持此格式。"],
    };
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(await file.slice(0, TEXT_LIMIT * 4).arrayBuffer(), { stream: file.size > TEXT_LIMIT * 4 });
  } catch {
    return { parser: "utf8-text", readability: "failed", status: "failed", extractedText: null, warnings: ["文件不是有效 UTF-8；原文件仍已保存。"] };
  }
  const truncated = decoded.length > TEXT_LIMIT || file.size > TEXT_LIMIT * 4;
  const text = decoded.slice(0, TEXT_LIMIT);
  if (extension === "json") {
    try { JSON.parse(text); } catch {
      return { parser: "utf8-json", readability: "failed", status: "failed", extractedText: text, warnings: ["JSON 语法无效；原文件仍已保存。"] };
    }
  }
  return {
    parser: extension === "json" ? "utf8-json" : "utf8-text",
    status: "parsed",
    readability: text.trim() ? "readable" : "unsupported",
    ...(text.trim() ? { readableAs: "text" as const } : {}),
    extractedText: text,
    warnings: !text.trim() ? ["文件没有可提取文字，原件已保存。"] : truncated ? ["提取文本已按 200,000 字符上限截断；原文件未截断。"] : [],
  };
}

export class EvidenceIngestionService {
  readonly #repository: IndexedDbProjectRepository;
  readonly #commands: ProjectCommandService;
  readonly #maxBytes: number;

  constructor(repository: IndexedDbProjectRepository, maxBytes = 100 * 1024 * 1024) {
    this.#repository = repository;
    this.#commands = new ProjectCommandService({ repository, authorization: new LocalAuthorization() });
    this.#maxBytes = maxBytes;
  }

  async ingest(head: ProjectHead, actorId: string, file: UploadFile, preparationLevel?: "required" | "recommended" | "additional"): Promise<ProjectHead> {
    if (!file.name.trim() || file.name.length > 300) throw new Error("FILE_NAME_INVALID");
    if (file.size === 0 || file.size > this.#maxBytes) throw new Error("FILE_SIZE_NOT_ALLOWED");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const now = new Date().toISOString();
    const assetId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const parse = await parseEvidenceFile(file);
    const asset = AssetRecordSchema.parse({
      id: assetId,
      projectId: head.projectId,
      fileName: file.name,
      mimeType: file.type || (/\.tiff?$/i.test(file.name) ? "image/tiff" : /\.png$/i.test(file.name) ? "image/png" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.webp$/i.test(file.name) ? "image/webp" : "application/octet-stream"),
      byteLength: file.size,
      sha256: sha256Hex(bytes),
      contentStatus: "available",
      createdAt: now,
    });
    const evidence = EvidenceSchema.parse({
      id: evidenceId,
      projectId: head.projectId,
      assetId,
      evidenceType: evidenceType(file),
      title: file.name,
      rightsDeclaration: null,
      intendedUse: "项目资料整理与候选提取",
      ...(preparationLevel ? { preparationLevel } : {}),
      recordedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      relatedEntityRefs: [head.snapshot.buildings[0]?.id ?? head.projectId],
      dataStatus: "available",
    });
    const parseRecord = ParseRecordSchema.parse({
      id: crypto.randomUUID(),
      projectId: head.projectId,
      assetId,
      evidenceId,
      parser: parse.parser,
      parserVersion: "1.0.0",
      status: parse.status,
      ...(parse.readability ? { readability: parse.readability } : {}),
      ...(parse.readableAs ? { readableAs: parse.readableAs } : {}),
      extractedText: parse.extractedText,
      warnings: parse.warnings,
      createdAt: now,
    });
    const sessionId = crypto.randomUUID();
    await this.#repository.stageAssets(sessionId, [asset], new Map([[asset.id, file]]));
    try {
      await this.#commands.execute({
        commandType: "ImportEvidence",
        commandId: crypto.randomUUID(),
        projectId: head.projectId,
        actorId,
        expectedRevisionId: head.revisionId,
        issuedAt: now,
        payload: { evidence, asset, parseRecord, stagingSessionId: sessionId },
      });
    } catch (error) {
      await this.#repository.cleanupStaging(sessionId);
      throw error;
    }
    const updated = await this.#repository.getProjectHead(head.projectId);
    if (!updated) throw new Error("PROJECT_NOT_FOUND_AFTER_EVIDENCE_IMPORT");
    return updated;
  }
}

export type { AssetRecord };
