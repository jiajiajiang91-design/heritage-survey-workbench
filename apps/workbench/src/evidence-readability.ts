import type { ProjectHead } from "@gujian/application";
type Snapshot = ProjectHead["snapshot"];
export function latestParse(snapshot: Snapshot, id: string) { return snapshot.parseRecords.filter((item) => item.evidenceId === id).at(-1); }
export function evidenceReadability(snapshot: Snapshot, id: string): { state: "readable" | "unsupported" | "failed"; kind?: "text" | "image"; detail: string } {
  const evidence = snapshot.evidences.find((item) => item.id === id);
  if (!evidence || evidence.dataStatus !== "available") return { state: "failed", detail: "原件不在本机，请补充文件。" };
  const parse = latestParse(snapshot, id);
  if (parse?.readability) return { state: parse.readability, ...(parse.readableAs ? { kind: parse.readableAs } : {}), detail: parse.warnings.join("；") };
  if (parse?.status === "failed") return { state: "failed", detail: parse.warnings.join("；") };
  if (parse?.status === "parsed" && parse.extractedText?.trim()) return { state: "readable", kind: "text", detail: parse.warnings.join("；") };
  if (evidence.imageDerivative) return { state: "readable", kind: "image", detail: "已有像素保持的派生图，内容仍需核对。" };
  return { state: "unsupported", detail: parse?.warnings.join("；") || "当前提取未支持此格式，请补充可读图像或文字。" };
}
