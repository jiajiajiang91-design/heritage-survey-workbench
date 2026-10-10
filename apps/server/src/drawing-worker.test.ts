import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PythonDrawingWorker } from "./drawing-worker.js";

it("读取生成记录中声明的中文图号文件，仍拒绝路径与未声明文件", () => {
  const jobId = crypto.randomUUID();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.data/drawing-staging", jobId);
  const output = resolve(root, "output");
  mkdirSync(output, { recursive: true });
  try {
    writeFileSync(resolve(output, "drawing-build-record.json"), JSON.stringify({ assets: [{ fileName: "内部-01.png" }] }));
    writeFileSync(resolve(output, "内部-01.png"), "内部图面测试字节");
    const worker = new PythonDrawingWorker();
    expect(worker.readAsset(jobId, "内部-01.png").toString()).toBe("内部图面测试字节");
    expect(() => worker.readAsset(jobId, "未声明.svg")).toThrow("DRAWING_ASSET_NOT_DECLARED");
    expect(() => worker.readAsset(jobId, "../内部-01.png")).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
