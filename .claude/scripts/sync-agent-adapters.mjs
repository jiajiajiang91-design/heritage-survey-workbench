// 以 .claude 为维护源，生成 Claude 与 Codex 使用的适配文件。
// 用法：node .claude/scripts/sync-agent-adapters.mjs [--check]

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const CHECK = process.argv.includes("--check");
const NOTICE = "<!-- 自动生成文件。维护源：.claude/project-rules.md。请勿直接修改。 -->\n\n";
const GENERATED_DIRS = [".agents/skills", ".codex/agents"];
const expected = new Map();

function listFiles(base, current = base) {
  if (!existsSync(current)) return [];
  const files = [];
  for (const name of readdirSync(current)) {
    const path = join(current, name);
    if (statSync(path).isDirectory()) files.push(...listFiles(base, path));
    else files.push(relative(base, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

function addExpected(path, content) {
  expected.set(path.replaceAll("\\", "/"), Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));
}

function frontmatterValue(frontmatter, key, sourcePath) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) throw new Error(`${sourcePath} 缺少 ${key}`);
  return match[1].trim();
}

function buildAgentAdapter(sourcePath) {
  const source = readFileSync(sourcePath, "utf8").replaceAll("\r\n", "\n");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${sourcePath} 的 frontmatter 无法解析`);
  const name = frontmatterValue(match[1], "name", sourcePath);
  const description = frontmatterValue(match[1], "description", sourcePath);
  const instructions = match[2].trim();
  return [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(instructions)}`,
    "",
  ].join("\n");
}

const rulesPath = join(ROOT, ".claude/project-rules.md");
const rules = readFileSync(rulesPath, "utf8").replaceAll("\r\n", "\n").trimEnd() + "\n";
addExpected("CLAUDE.md", NOTICE + rules);
addExpected("AGENTS.md", NOTICE + rules);

const sourceAgents = join(ROOT, ".claude/agents");
for (const file of listFiles(sourceAgents).filter((path) => path.endsWith(".md"))) {
  const target = `.codex/agents/${file.replace(/\.md$/, ".toml")}`;
  addExpected(target, buildAgentAdapter(join(sourceAgents, file)));
}

const sourceSkills = join(ROOT, ".claude/skills");
for (const file of listFiles(sourceSkills)) {
  addExpected(`.agents/skills/${file}`, readFileSync(join(sourceSkills, file)));
}

function assertGeneratedTarget(path) {
  const absolute = resolve(ROOT, path);
  const rel = relative(ROOT, absolute);
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error(`拒绝处理仓库外路径：${absolute}`);
  }
  return absolute;
}

if (CHECK) {
  const issues = [];
  for (const [path, content] of expected) {
    const absolute = join(ROOT, path);
    if (!existsSync(absolute)) issues.push(`缺少 ${path}`);
    else if (!readFileSync(absolute).equals(content)) issues.push(`内容不同步 ${path}`);
  }
  for (const dir of GENERATED_DIRS) {
    const expectedFiles = new Set(
      [...expected.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
    );
    for (const file of listFiles(join(ROOT, dir))) {
      if (!expectedFiles.has(file)) issues.push(`存在多余适配文件 ${dir}/${file}`);
    }
  }
  if (issues.length) {
    console.log(`跨 Agent 适配未同步（${issues.length}）`);
    for (const issue of issues) console.log(`  ${issue}`);
    process.exit(1);
  }
  console.log(`跨 Agent 适配一致，共 ${expected.size} 个文件`);
  process.exit(0);
}

for (const dir of GENERATED_DIRS) {
  const absolute = assertGeneratedTarget(dir);
  rmSync(absolute, { recursive: true, force: true });
  mkdirSync(absolute, { recursive: true });
}

for (const [path, content] of expected) {
  const absolute = join(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

console.log(`已从 .claude 生成 ${expected.size} 个跨 Agent 适配文件`);
