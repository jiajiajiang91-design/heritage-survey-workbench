import { z } from "zod";
import { taskOutputUnit, type AssetRecord, type GeometryRevision, type OutputUnit } from "@gujian/domain";
import type { ProjectHead } from "@gujian/application";
import type { IndexedDbProjectRepository } from "./indexeddb-project-repository.js";
import { sha256Hex } from "./hash.js";

const manifestSchema = z.object({
  schemaVersion: z.literal("1.0"), projectId: z.string(), projectRevisionId: z.string(), geometryRevisionId: z.string(), geometrySpecId: z.string(),
  inputHash: z.string(), entityClosureHash: z.string(), interfaceClosureHash: z.string(), geometrySignature: z.string(),
  assets: z.array(z.object({ kind: z.string(), fileName: z.string(), sha256: z.string(), byteLength: z.number().int().positive(), mimeType: z.string() })),
}).passthrough();
export type CheckedModelFile = { kind: GeometryRevision["assets"][number]["kind"]; record: AssetRecord; bytes: Uint8Array };

function fail(code: string, detail: string): never { throw new Error(`${code}:${detail}`); }
function json(bytes: Uint8Array, kind: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("MODEL_CHECK_FILE_INVALID", kind); }
}
function checkIfcUnit(bytes: Uint8Array, unit: OutputUnit) {
  const text = new TextDecoder().decode(bytes);
  const prefix = { mm: ".MILLI.", cm: ".CENTI.", m: "$" }[unit];
  const lengthUnits = new Map([...text.matchAll(/#(\d+)\s*=\s*IFCSIUNIT\s*\(\s*\*\s*,\s*\.LENGTHUNIT\.\s*,\s*(\$|\.\w+\.)\s*,\s*\.METRE\.\s*\)/gi)].map((match) => [match[1], match[2]!.toUpperCase()]));
  const assigned = [...text.matchAll(/IFCUNITASSIGNMENT\s*\(\s*\(([^)]*)\)\s*\)/gi)].flatMap((match) => [...match[1]!.matchAll(/#(\d+)/g)].map((ref) => lengthUnits.get(ref[1]))).filter((value) => value !== undefined);
  if (!text.trimStart().startsWith("ISO-10303-21;") || !text.includes("END-ISO-10303-21;")) fail("MODEL_CHECK_FILE_INVALID", "ifc");
  if (!assigned.length || assigned.some((value) => value !== prefix)) fail("MODEL_CHECK_OUTPUT_UNIT_MISMATCH", "IFC 长度单位与当前任务不一致");
}
function checkGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 20) fail("MODEL_CHECK_FILE_INVALID", "glb");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength
    || view.getUint32(16, true) !== 0x4e4f534a) fail("MODEL_CHECK_FILE_INVALID", "glb");
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail("MODEL_CHECK_FILE_INVALID", "glb chunk");
    const size = view.getUint32(offset, true);
    if (size % 4 || offset + 8 + size > bytes.byteLength) fail("MODEL_CHECK_FILE_INVALID", "glb chunk");
    offset += 8 + size;
  }
  const document = z.object({ asset: z.object({ version: z.literal("2.0") }), meshes: z.array(z.unknown()).min(1) }).safeParse(json(bytes.subarray(20, 20 + view.getUint32(12, true)), "glb JSON"));
  if (!document.success) fail("MODEL_CHECK_FILE_INVALID", "glb JSON");
}

export async function checkStoredModelFiles(head: ProjectHead, geometry: GeometryRevision, repository: IndexedDbProjectRepository): Promise<CheckedModelFile[]> {
  const required = ["ifc", "glb", "brepBundle", "manifest", "sourceMap", "report", "preview"];
  if (required.some((kind) => !geometry.assets.some((asset) => asset.kind === kind)) || new Set(geometry.assets.map((asset) => asset.kind)).size !== geometry.assets.length
    || new Set(geometry.assets.map((asset) => asset.assetId)).size !== geometry.assets.length) fail("MODEL_CHECK_FILES_MISSING", "模型文件集合不完整或重复");
  const files: CheckedModelFile[] = [];
  for (const asset of geometry.assets) {
    let stored: Awaited<ReturnType<IndexedDbProjectRepository["getAsset"]>>;
    try { stored = await repository.getAsset(asset.assetId); }
    catch { return fail("MODEL_CHECK_FILES_MISSING", asset.kind); }
    const { record, content } = stored;
    const bytes = new Uint8Array(await content.arrayBuffer());
    if (record.id !== asset.assetId || record.projectId !== head.projectId || record.contentStatus !== "available" || !bytes.byteLength
      || bytes.byteLength !== asset.byteLength || record.byteLength !== asset.byteLength || sha256Hex(bytes) !== asset.sha256 || record.sha256 !== asset.sha256
      || record.mimeType !== asset.mimeType) fail("MODEL_CHECK_ASSET_MISMATCH", asset.kind);
    files.push({ kind: asset.kind, record, bytes });
  }
  const manifestFile = files.find((file) => file.kind === "manifest")!;
  const parsed = manifestSchema.safeParse(json(manifestFile.bytes, "manifest"));
  if (!parsed.success) fail("MODEL_CHECK_MANIFEST_MISMATCH", "清单格式或版本无效");
  const manifest = parsed.data;
  if (manifest.projectId !== head.projectId || manifest.projectRevisionId !== geometry.projectRevisionId || manifest.geometryRevisionId !== geometry.id
    || manifest.geometrySpecId !== geometry.geometrySpecId || manifest.inputHash !== geometry.inputHash || manifest.entityClosureHash !== geometry.entityClosureHash
    || manifest.interfaceClosureHash !== geometry.interfaceClosureHash || manifest.geometrySignature !== geometry.geometrySignature) fail("MODEL_CHECK_MANIFEST_MISMATCH", "清单与当前几何版本不一致");
  const expectedFiles = files.filter((file) => file.kind !== "manifest");
  if (manifest.assets.length !== expectedFiles.length || new Set(manifest.assets.map((item) => item.kind)).size !== manifest.assets.length
    || new Set(manifest.assets.map((item) => item.fileName)).size !== manifest.assets.length) fail("MODEL_CHECK_MANIFEST_MISMATCH", "清单文件集合不完整或重复");
  for (const file of expectedFiles) {
    const item = manifest.assets.find((asset) => asset.kind === file.kind);
    if (!item || item.fileName !== file.record.fileName || item.sha256 !== file.record.sha256 || item.byteLength !== file.record.byteLength
      || item.mimeType !== file.record.mimeType) fail("MODEL_CHECK_MANIFEST_MISMATCH", file.kind);
  }
  checkIfcUnit(files.find((file) => file.kind === "ifc")!.bytes, taskOutputUnit(head.snapshot));
  checkGlb(files.find((file) => file.kind === "glb")!.bytes);
  const report = z.object({ schemaVersion: z.literal("1.0"), geometryRevisionId: z.literal(geometry.id), geometrySignature: z.literal(geometry.geometrySignature) }).safeParse(json(files.find((file) => file.kind === "report")!.bytes, "report"));
  if (!report.success) fail("MODEL_CHECK_FILE_INVALID", "geometry report");
  const sourceLines = new TextDecoder().decode(files.find((file) => file.kind === "sourceMap")!.bytes).trim().split(/\r?\n/);
  for (const line of sourceLines) json(new TextEncoder().encode(line), "sourceMap");
  return files;
}
