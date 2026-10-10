// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { parseEvidenceFile, sha256Hex } from "@gujian/infrastructure";
import { createLocalProject, projectRepository, projectCommands, projectPackages, evidenceIngestion, localActorId, prepareEvidenceFiles } from "./workbench";
import { processStoredEvidence } from "./evidence-processing";
import { evidenceReadability, latestParse } from "./evidence-readability";
import { readModelInputs, ModelRunClient } from "./model-run-client";
const storage = new Map<string,string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key,value) });
const converted = { base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a17sAAAAASUVORK5CYII=", sourceSizePixels: [1,1] as [number,number], derivedSizePixels: [1,1] as [number,number], mode: "LA", pixelSha256: "a".repeat(64) };
const actor = () => localActorId();
beforeEach(() => projectRepository.clearAllData());
afterEach(() => vi.restoreAllMocks());
async function original() {
  let head = await createLocalProject({ name: "TIFF 处理检查", buildingName: "测试建筑", locationText: "" });
  head = await evidenceIngestion.ingest(head, actor(), new File([new Uint8Array([73,73,42,0,1,2])], "原始图.tif", { type: "image/tiff" }), "required");
  return head;
}
describe("原始资料处理", () => {
  it("派生关联经命令保存，原件保持，回导可恢复且模型使用实际派生图", async () => {
    let head = await original(); const before = head.snapshot.evidences[0]!;
    const source = await projectRepository.getAsset(before.assetId);
    head = await processStoredEvidence({ repository: projectRepository, commands: projectCommands, head, actorId: actor(), evidenceId: before.id, convert: async () => converted });
    const evidence = head.snapshot.evidences[0]!; const derivative = evidence.imageDerivative!;
    expect(evidence.id).toBe(before.id); expect(evidence.assetId).toBe(before.assetId); expect(derivative.coordinateMapping).toBe("identity");
    expect(derivative.sourceSizePixels).toEqual(derivative.derivedSizePixels); expect(derivative.originalSha256).toBe(source.record.sha256);
    expect(new Uint8Array(await (await projectRepository.getAsset(before.assetId)).content.arrayBuffer())).toEqual(new Uint8Array(await source.content.arrayBuffer()));
    expect(latestParse(head.snapshot, evidence.id)?.readability).toBe("readable");
    const inputs = await readModelInputs(head, projectRepository, [evidence.id], true);
    expect(inputs).toEqual([expect.objectContaining({ evidenceId: before.id, assetSha256: source.record.sha256, processedAssetSha256: (await projectRepository.getAsset(derivative.assetId)).record.sha256, mediaType: "image/png", base64: converted.base64 })]);
    let requestBody: { evidences: unknown[] } | undefined;
    const network = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/session") return new Response(JSON.stringify({csrfToken:"test",capabilityToken:"test"}));
      requestBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({error:"EXPECTED_TEST_STOP"}),{status:503});
    });
    const client = new ModelRunClient({repository:projectRepository,commands:projectCommands,fetchImpl:network as typeof fetch});
    await expect(client.runMeasurementTranscription(head,actor(),[evidence.id],()=>{})).rejects.toThrow("EXPECTED_TEST_STOP");
    expect(requestBody?.evidences).toEqual(inputs);
    const bundle = await projectPackages.exportZip(head.projectId); await projectRepository.clearAllData();
    const projectId = await projectPackages.import(bundle, "处理.gujian.zip", actor());
    head = (await projectRepository.getProjectHead(projectId))!;
    expect(head.snapshot.evidences[0]).toEqual(evidence);
    expect((await readModelInputs(head, projectRepository, [evidence.id], false))[0]).toEqual(inputs[0]);
  });
  it("失败保存原件，重试不重建资料，最新成功结果用于提取", async () => {
    let head = await original(); const id = head.snapshot.evidences[0]!.id;
    head = await processStoredEvidence({ repository: projectRepository, commands: projectCommands, head, actorId: actor(), evidenceId: id, convert: async () => { throw new Error("IMAGE_PROCESSOR_UNAVAILABLE"); } });
    expect(evidenceReadability(head.snapshot,id)).toMatchObject({ state: "failed", detail: expect.stringContaining("本机图像处理程序不可用") });
    expect(head.snapshot.evidences).toHaveLength(1);
    head = await processStoredEvidence({ repository: projectRepository, commands: projectCommands, head, actorId: actor(), evidenceId: id, convert: async () => converted });
    expect(head.snapshot.evidences).toHaveLength(1); expect(head.snapshot.parseRecords).toHaveLength(3);
    expect(evidenceReadability(head.snapshot,id)).toMatchObject({ state: "readable", kind: "image" });
    const firstDerivative = head.snapshot.evidences[0]!.imageDerivative!.assetId;
    head = await processStoredEvidence({ repository: projectRepository, commands: projectCommands, head, actorId: actor(), evidenceId: id, convert: async () => { throw new Error("IMAGE_MULTIFRAME_UNSUPPORTED"); } });
    expect(evidenceReadability(head.snapshot,id).state).toBe("unsupported");
    expect(head.snapshot.evidences[0]!.imageDerivative!.assetId).toBe(firstDerivative);
    expect((await projectRepository.getAsset(firstDerivative)).record.contentStatus).toBe("available");
  });
  it("错误项目、原资产和原件哈希不允许写入派生关联", async () => {
    const head = await original(); const evidence = head.snapshot.evidences[0]!;
    const asset = { id: crypto.randomUUID(), projectId: head.projectId, fileName: "derived.png", mimeType: "image/png", byteLength: 8, sha256: "b".repeat(64), contentStatus: "available" as const, createdAt: new Date().toISOString() };
    const parsed = { ...head.snapshot.parseRecords[0]!, id: crypto.randomUUID(), readability: "readable" as const, readableAs: "image" as const };
    const payload = { evidence: { ...evidence, imageDerivative: { assetId: asset.id, originalSha256: "f".repeat(64), sourceSizePixels: [1,1] as [number,number], derivedSizePixels: [1,1] as [number,number], mode: "1", pixelSha256: "a".repeat(64), coordinateMapping: "identity" as const } }, parseRecord: parsed, derivedAsset: asset, stagingSessionId: crypto.randomUUID() };
    const command = { commandType: "ProcessEvidence" as const, commandId: crypto.randomUUID(), projectId: head.projectId, actorId: actor(), expectedRevisionId: head.revisionId, issuedAt: new Date().toISOString(), payload };
    await expect(projectCommands.execute(command)).rejects.toThrow("original asset and derivative source hash");
    await expect(projectCommands.execute({ ...command, commandId: crypto.randomUUID(), payload: { ...payload, evidence: { ...payload.evidence, assetId: crypto.randomUUID() } } })).rejects.toThrow();
    const correctSource = { ...payload, evidence: { ...payload.evidence, imageDerivative: { ...payload.evidence.imageDerivative, originalSha256: (await projectRepository.getAsset(evidence.assetId)).record.sha256 } } };
    await expect(projectCommands.execute({ ...command, commandId: crypto.randomUUID(), payload: { ...correctSource, parseRecord: { ...parsed, projectId: crypto.randomUUID() } } })).rejects.toThrow("processing must preserve");
    expect((await projectRepository.getProjectHead(head.projectId))!.revisionId).toBe(head.revisionId);
  });
  it("混合文件继续处理，失败项不静默参与请求，也不调用模型", async () => {
    const head = await createLocalProject({ name: "混合检查", buildingName: "测试建筑", locationText: "" });
    const prepared = await prepareEvidenceFiles(head,[{ file: new File(["broken"],"失败.jpg",{type:"image/jpeg"}), level:"required" },{file:new File(["现场尺寸 6000 mm"],"尺寸.txt",{type:"text/plain"}),level:"required"},{file:new File(["file"],"其他.docx"),level:"additional"}]);
    expect(prepared.head.snapshot.evidences).toHaveLength(3); expect(prepared.failures).toHaveLength(2);
    const ids = prepared.head.snapshot.evidences.map((e) => e.id);
    const network = vi.fn(); const client = new ModelRunClient({ repository: projectRepository, commands: projectCommands, fetchImpl: network });
    await expect(client.runMeasurementTranscription(prepared.head,actor(),ids,()=>{})).rejects.toThrow("以下资料未参与提取"); expect(network).not.toHaveBeenCalled();
    expect(await readModelInputs(prepared.head,projectRepository,[ids[1]!],false)).toEqual([expect.objectContaining({ text:"现场尺寸 6000 mm" })]);
  });
  it("无文字层 PDF 明确未支持，不伪装文字输入", async () => {
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"];
    let pdf="%PDF-1.4\n"; const offsets=[0]; for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";}
    const xref=pdf.length;pdf+="xref\n0 5\n0000000000 65535 f \n"+offsets.slice(1).map((offset)=>String(offset).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
    const parsed=await parseEvidenceFile(new File([pdf],"无文字层.pdf",{type:"application/pdf"}));
    expect(parsed.status).toBe("metadataOnly");expect(parsed.readability).toBe("unsupported");expect(parsed.extractedText).toBeNull();expect(parsed.warnings.join()).toContain("没有文字层");
  });
  it("长中文文本截断不误判 UTF-8，大图不挡住可读小图", async () => {
    const parsed = await parseEvidenceFile(new File(["古".repeat(300_000)],"长文字.txt",{type:"text/plain"}));
    expect(parsed.readability).toBe("readable"); expect(parsed.extractedText).toBe("古".repeat(200_000)); expect(parsed.warnings.join()).toContain("截断");
    vi.stubGlobal("createImageBitmap", async () => ({ width: 20, height: 30, close() {} }));
    const big = await parseEvidenceFile(new File([new Uint8Array(12 * 1024 * 1024 + 1)],"大图.png",{type:"image/png"}));
    expect(big.readability).toBe("unsupported"); expect(big.warnings.join()).toContain("12 MiB");
    expect(await parseEvidenceFile(new File(["test"],"小图.png",{type:"image/png"}))).toMatchObject({readability:"readable",readableAs:"image"});
  });
  it("图像解码失败与有效文字有明确状态，空白文字未支持", async () => {
    vi.stubGlobal("createImageBitmap", async () => { throw new Error("decode"); });
    expect(await parseEvidenceFile(new File(["bad"],"坏图.png",{type:"image/png"}))).toMatchObject({ readability:"failed" });
    expect(await parseEvidenceFile(new File(["尺寸"],"文字.txt",{type:"text/plain"}))).toMatchObject({ readability:"readable",readableAs:"text" });
    expect(await parseEvidenceFile(new File(["   "],"空白.txt",{type:"text/plain"}))).toMatchObject({ readability:"unsupported" });
  });
});
