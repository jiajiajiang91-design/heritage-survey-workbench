import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkbenchServer } from "./index.js";
import { PythonImageProcessor, type ImageProcessingResult } from "./image-processor.js";
const root = resolve("../..");
const python = process.env.GUJIAN_PYTHON ?? resolve(root, process.platform === "win32" ? "workers/cad/.venv/Scripts/python.exe" : "workers/cad/.venv/bin/python");
const samples = resolve(root, "文档/05_验证证据/03_公开实测样本/Dai_Loy_HABS");
const result: ImageProcessingResult = { base64: "iVBORw0KGgo=", sourceSizePixels: [1,1], derivedSizePixels: [1,1], mode: "1", pixelSha256: "a".repeat(64) };
const servers: ReturnType<typeof createWorkbenchServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done())); });
describe("本机图像处理", () => {
  it("会话及来源校验后才处理原始字节，不依赖模型凭证", async () => {
    const received: Buffer[] = [];
    const server = createWorkbenchServer({ imageProcessor: { async process(bytes) { received.push(bytes); return result; } } }); servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    expect((await fetch(base + "/api/evidence/process-image", { method: "POST", body: "TIFF" })).status).toBe(403);
    const session = await fetch(base + "/api/session"); const { csrfToken } = await session.json() as { csrfToken: string }; const cookie = session.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(base + "/api/evidence/process-image", { method: "POST", headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/octet-stream" }, body: new Uint8Array([73,73,42,0]) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result); expect(received).toEqual([Buffer.from([73,73,42,0])]);
    expect((await fetch(base + "/api/evidence/process-image", { method: "POST", headers: { cookie, "x-csrf-token": csrfToken, origin: "https://invalid.example" }, body: "TIFF" })).status).toBe(403);
    expect(received).toHaveLength(1);
  });
  it.runIf(existsSync(python))("公开 TIFF 三份经实际 worker 解码，独立复核像素、尺寸和模式", async () => {
    const worker = new PythonImageProcessor();
    for (const [name, size] of [["highres_00016a.tif",[14450,9632]],["highres_00017a.tif",[14442,9632]],["highres_00018a.tif",[14464,9632]]] as const) {
      const path = resolve(samples, name); const converted = await worker.process(readFileSync(path));
      expect(converted.sourceSizePixels).toEqual(size); expect(converted.derivedSizePixels).toEqual(size); expect(converted.mode).toBe("1");
      const verification = JSON.parse(execFileSync(python, ["-c", "import sys,io,json,hashlib; from PIL import Image; Image.MAX_IMAGE_PIXELS=150_000_000; a=Image.open(sys.argv[1]); a.load(); b=Image.open(io.BytesIO(sys.stdin.buffer.read())); b.load(); print(json.dumps({'same':a.size==b.size and a.mode==b.mode and a.tobytes()==b.tobytes(),'hash':hashlib.sha256(a.tobytes()).hexdigest()}))", path], { input: Buffer.from(converted.base64, "base64"), maxBuffer: 1024 * 1024 }).toString()) as { same: boolean; hash: string };
      expect(verification.same).toBe(true); expect(converted.pixelSha256).toBe(verification.hash);
    }
  }, 30_000);
  it.runIf(existsSync(python))("损坏文件失败，多帧与 CMYK 明确未支持", async () => {
    const worker = new PythonImageProcessor();
    await expect(worker.process(Buffer.from("broken"))).rejects.toThrow("IMAGE_DECODE_FAILED");
    const multi = execFileSync(python,["-c", "import sys,io; from PIL import Image; o=io.BytesIO(); Image.new('L',(2,2)).save(o,format='TIFF',save_all=True,append_images=[Image.new('L',(2,2),2)]); sys.stdout.buffer.write(o.getvalue())"]);
    await expect(worker.process(multi)).rejects.toThrow("IMAGE_MULTIFRAME_UNSUPPORTED");
    const cmyk = execFileSync(python,["-c", "import sys,io; from PIL import Image; o=io.BytesIO(); Image.new('CMYK',(2,2)).save(o,format='TIFF'); sys.stdout.buffer.write(o.getvalue())"]);
    await expect(worker.process(cmyk)).rejects.toThrow("IMAGE_MODE_UNSUPPORTED");
  });
});
