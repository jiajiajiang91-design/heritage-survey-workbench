import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// 界面用语表（01_产品/03_界面与交互形态.md 表 13）：领域词不进界面正文。
// 扫描工作台源码里注释以外的全部文本，出现禁用词即失败。禁用词与替换说法以表 13 为准。
const BANNED = ["证据", "阻断", "代理成果", "代理交付", "稳定键", "未知项", "存疑", "规则层", "示例资料", "未获资格", "正式资格", "构件对象", "几何", "事实"];

function sourceFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) { collected.push(...sourceFiles(full)); continue; }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts")) continue;
    collected.push(full);
  }
  return collected;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("界面用语", () => {
  it("工作台源码的界面文本不含用语表禁用的领域词", () => {
    const root = import.meta.dirname;
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        const hits = BANNED.filter((word) => line.includes(word));
        if (hits.length) offenders.push(`${relative(root, file)}:${index + 1} ${hits.join("、")}`);
      });
    }
    expect(offenders, "界面文本里出现了用语表禁用的词，按表 13 改写").toEqual([]);
  });
});
