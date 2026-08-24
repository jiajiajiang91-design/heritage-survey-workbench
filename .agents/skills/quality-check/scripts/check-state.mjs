// 实施单元与状态文件的一致性检查：目录事实与路线图、索引说的是否一致。
// 用法：node .claude/skills/quality-check/scripts/check-state.mjs
// 退出码 0 表示一致，1 表示存在不一致。脚本只报差异与该改的位置，不自动改写文档。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const UNITS = join(ROOT, "文档/04_实施单元");
const ARCHIVE = join(ROOT, "文档/99_历史归档/05_实施单元归档");
const ROADMAP = join(UNITS, "00_路线图.md");
const issues = [];
const notes = [];
const acceptanceProgress = new Map();

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()) : []);
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const active = dirs(UNITS);
const archived = dirs(ARCHIVE);

// 1 每个进行中单元必须有三件套
for (const unit of active) {
  for (const file of ["规格.md", "计划.md", "验收.md"]) {
    if (!existsSync(join(UNITS, unit, file))) issues.push(`单元 ${unit} 缺 ${file}`);
  }
}

// 2 必填节。模板见 .claude/skills/spec-write/templates/
const REQUIRED = { "规格.md": ["不做"], "计划.md": ["完成定义"], "验收.md": ["复查清单"] };
for (const unit of active) {
  for (const [file, sections] of Object.entries(REQUIRED)) {
    const text = read(join(UNITS, unit, file));
    if (!text) continue;
    for (const s of sections) {
      if (!new RegExp(`^##.*${s}`, "m").test(text)) issues.push(`单元 ${unit} 的 ${file} 缺必填节：${s}`);
    }
  }
}

// 3 每个任务组必须自带验证，不攒到最后一起验
for (const unit of active) {
  const text = read(join(UNITS, unit, "计划.md"));
  if (!text) continue;
  for (const group of text.split(/^### /m).slice(1)) {
    const title = group.split(/\r?\n/)[0].trim();
    if (!/^验证：/m.test(group)) issues.push(`单元 ${unit} 的任务组 ${title} 没有本组验证`);
  }
}

// 4 验收表的空结果条数。开工前写定条件、收工时填结果，空着说明还没判定
for (const unit of active) {
  const text = read(join(UNITS, unit, "验收.md"));
  // 只数第一节的验收条件表，后面几节可能也有编号表格
  const first = text.split(/^## /m).find((s) => /^.*验收条件\s*$/m.test(s.split(/\r?\n/)[0])) ?? "";
  const rows = first.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const blank = rows.filter((l) => {
    const cells = l.split("|").map((c) => c.trim());
    return !cells[cells.length - 2];
  });
  const failed = rows.filter((l) => /未通过|未过|不通过/.test(l));
  if (rows.length) {
    acceptanceProgress.set(unit, { judged: rows.length - blank.length, total: rows.length });
    notes.push(`单元 ${unit} 验收 ${rows.length - blank.length}/${rows.length} 条已判定，其中未通过 ${failed.length} 条`);
    if (!blank.length && !failed.length) notes.push(`单元 ${unit} 全部通过，可按确认规则关闭`);
  }
}

// 5 三层开工入口必须存在，路线图只保留规定字段
const prd = read(join(ROOT, "文档/01_产品/01_核心PRD.md"));
const architecture = read(join(ROOT, "文档/02_技术/01_技术架构.md"));
if (!/^## 0\. 项目任务摘要$/m.test(prd)) issues.push("核心 PRD 缺少第 0 节项目任务摘要");
if (!/^## 0\. 工程约束摘要$/m.test(architecture)) issues.push("技术架构缺少第 0 节工程约束摘要");

// 6 路线图的单元、字段与验收进度必须和目录事实一致
const roadmap = read(ROADMAP);
if (!roadmap) {
  issues.push("找不到 文档/04_实施单元/00_路线图.md");
} else {
  if (!roadmap.includes("| 阶段 | 目标 | 范围 | 依赖 | 验收 | 状态 |")) {
    issues.push("路线图缺少规定字段：阶段、目标、范围、依赖、验收、状态");
  }
  for (const unit of active) {
    const name = unit.replace(/^\d+_/, "");
    if (!roadmap.includes(name)) issues.push(`路线图没有列出进行中的单元 ${unit}`);
    const progress = acceptanceProgress.get(unit);
    const row = roadmap.split(/\r?\n/).find((line) => line.startsWith("|") && line.includes(name));
    const cells = row?.split("|").map((cell) => cell.trim()) ?? [];
    const status = cells.at(-2) ?? "";
    const stated = status.match(/(\d+)\s*\/\s*(\d+)/);
    if (progress && stated && (progress.judged !== Number(stated[1]) || progress.total !== Number(stated[2]))) {
      issues.push(`单元 ${unit} 验收为 ${progress.judged}/${progress.total}，路线图写为 ${stated[1]}/${stated[2]}`);
    }
    if (progress && /已完成/.test(status) && progress.judged !== progress.total) {
      issues.push(`单元 ${unit} 仍有未判定验收，路线图所在阶段已写为完成`);
    }
  }
  for (const unit of archived) {
    const name = unit.replace(/^\d+_/, "");
    const row = roadmap.split(/\r?\n/).find((l) => l.includes(name) && l.startsWith("|"));
    if (!row) issues.push(`路线图没有留下已归档单元 ${unit} 的记录`);
    else if (!/已完成|归入|归档/.test(row)) issues.push(`单元 ${unit} 已归档，路线图那行仍写着进行中：${row.trim().slice(0, 60)}`);
  }
}

// 7 索引列出的产品与技术文档与实际目录一致
const index = read(join(ROOT, "文档/00_索引.md"));
for (const dir of ["01_产品", "02_技术", "06_研究底稿"]) {
  const real = existsSync(join(ROOT, "文档", dir))
    ? readdirSync(join(ROOT, "文档", dir)).filter((n) => n.endsWith(".md")) : [];
  for (const file of real) {
    const stem = file.replace(/\.md$/, "");
    if (!index.includes(stem)) issues.push(`索引没有列出 文档/${dir}/${file}`);
  }
}

// 8 pm-context 的权威指针必须可达
const ctx = read(join(ROOT, ".claude/context/pm-context.md"));
for (const m of ctx.matchAll(/`(文档\/[^`\n]+)`/g)) {
  const p = m[1].replace(/\/$/, "");
  if (!existsSync(join(ROOT, p))) issues.push(`pm-context 指向不存在的文档：${p}`);
}

console.log(`实施区单元 ${active.length} 个，已归档 ${archived.length} 个`);
for (const n of notes) console.log(`  ${n}`);
if (issues.length) {
  console.log(`\n不一致（${issues.length}）`);
  for (const i of issues) console.log(`  ${i}`);
} else {
  console.log("\n状态一致");
}
process.exit(issues.length ? 1 : 0);
