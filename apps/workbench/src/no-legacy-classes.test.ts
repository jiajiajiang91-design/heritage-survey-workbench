import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 实施单元 08 迁移期间的临时守卫：新建的外壳与页面不得复用旧 styles.css 里的类名。
// 旧样式里有大量元素级选择器与 !important，复用类名会让旧规则叠到新页面上，
// 等旧样式删光后这条测试随之删除。

const SOURCE_ROOT = import.meta.dirname;
const LEGACY = readFileSync(join(SOURCE_ROOT, "styles.css"), "utf8");
const legacyClasses = new Set([...LEGACY.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]!)
  .filter((name) => !name.startsWith("gj-") && !name.startsWith("ws-") && !name.startsWith("sc-")));

function tsxFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) collected.push(...tsxFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) collected.push(full);
  }
  return collected;
}

describe("新页面层不复用旧类名（实施单元 08 迁移期）", () => {
  it("shell 与 screens 里的 className 不含 styles.css 的旧类", () => {
    const offenders: string[] = [];
    for (const file of [...tsxFiles(join(SOURCE_ROOT, "shell")), ...tsxFiles(join(SOURCE_ROOT, "screens"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/className=["'`]([^"'`]+)["'`]/g)) {
        for (const name of match[1]!.split(/\s+/)) {
          if (legacyClasses.has(name)) offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
