import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const python = process.env.GUJIAN_PYTHON ?? resolve(root, process.platform === "win32" ? "workers/cad/.venv/Scripts/python.exe" : "workers/cad/.venv/bin/python");
export const ImageProcessingResultSchema = z.object({
  base64: z.string().min(1).max(16 * 1024 * 1024),
  sourceSizePixels: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  derivedSizePixels: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  mode: z.string().min(1).max(20), pixelSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine((v) => v.sourceSizePixels[0] === v.derivedSizePixels[0] && v.sourceSizePixels[1] === v.derivedSizePixels[1]);
export type ImageProcessingResult = z.infer<typeof ImageProcessingResultSchema>;
export interface ImageProcessor { process(data: Buffer): Promise<ImageProcessingResult>; }

export class PythonImageProcessor implements ImageProcessor {
  async process(data: Buffer): Promise<ImageProcessingResult> {
    const child = spawn(python, [resolve(root, "workers/cad/process_image.py")], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    return new Promise((resolveResult, reject) => {
      let output = ""; let finished = false;
      const fail = (code: string) => { if (finished) return; finished = true; clearTimeout(timer); child.kill(); reject(new Error(code)); };
      const timer = setTimeout(() => fail("IMAGE_PROCESSING_TIMEOUT"), 60_000);
      child.once("error", () => fail("IMAGE_PROCESSOR_UNAVAILABLE"));
      child.stdin.on("error", () => fail("IMAGE_PROCESSOR_UNAVAILABLE"));
      child.stderr.resume(); child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 20 * 1024 * 1024) fail("IMAGE_INPUT_TOO_LARGE"); });
      child.once("close", (code) => {
        if (finished) return; clearTimeout(timer);
        if (code !== 0) return fail("IMAGE_PROCESSOR_UNAVAILABLE");
        try {
          const value = JSON.parse(output) as Record<string, unknown>;
          if (typeof value.error === "string" && /^IMAGE_[A-Z_]+$/.test(value.error)) return fail(value.error);
          const result = ImageProcessingResultSchema.safeParse(value);
          if (!result.success) return fail("IMAGE_INPUT_TOO_LARGE");
          finished = true; resolveResult(result.data);
        } catch { fail("IMAGE_DECODE_FAILED"); }
      });
      child.stdin.end(data);
    });
  }
}
