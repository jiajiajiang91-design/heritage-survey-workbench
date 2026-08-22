// 查测试里用模板字符串拼正则的写法。用法：node .claude/skills/quality-check/scripts/check-test-regex.mjs
//
// 起因：2026-08-22 单元 06 里连续两次写出永远匹配不到的正则，测试全绿但什么都没查。
// 原因是模板字符串会先吃掉一层反斜杠：`var\\(${prefix}\\)` 里的 \\( 变成 (，
// 括号被当成分组，`\\s` 变成 s、`\\d` 变成 d。写的人看不出来，测试也不会报错。
//
// 处置：测试文件里不许用 new RegExp 加模板字符串。要动态拼就先用写死的正则全量提取，
// 再在 JS 里按条件筛。确实需要动态构造时，在同一行写 // 允许动态正则 并说明为什么。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", ".turbo"]);

function testFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...testFiles(full));
    else if (/\.test\.[cm]?[jt]sx?$/.test(name)) found.push(full);
  }
  return found;
}

const hits = [];
for (const file of testFiles(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (!line.includes("new RegExp(`")) return;
    if (line.includes("允许动态正则")) return;
    hits.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (hits.length) {
  console.error(`测试里有 ${hits.length} 处用模板字符串拼正则，反斜杠会被吃掉一层，正则可能永远匹配不到：\n`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error("\n改成写死的正则再在 JS 里筛。确有必要时在该行加 // 允许动态正则 并写明理由。");
  process.exit(1);
}

console.log("测试里没有用模板字符串拼的正则");
