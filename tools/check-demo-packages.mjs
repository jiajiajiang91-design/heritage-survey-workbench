// 演示包的内部一致性核对。矩阵检查只看七格有没有内容，不看包里的记录是否自洽。
//
// 这个脚本查的三类问题都真实发生过，每次都是靠人工解包比对才发现，构建本身退出码为 0：
//
// 一、未解决问题被静默作废。规则核对原来一律把未解决问题标成已被替代，
//     三个项目共 13 条没人处理过的问题在问题队列与交付阻断里同时消失。
// 二、命令回执没随包走。dist 落后于源码时构建照样成功，包里少了回执，
//     导入后修改历史全部显示未记录动作类型。
// 三、清单与包内容对不上。manifest 的计数是构建时另算的，与包里的记录可能脱节。

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync } from "../packages/infrastructure/node_modules/fflate/esm/browser.js";

const ROOT = resolve(import.meta.dirname, "..");
const DEMO_DIR = resolve(ROOT, "apps/workbench/public/demo");
const NAMES = ["t0b-construction-sample", "dai-loy-habs-ca-2071-w", "gaodu-yuhuang-temple-main-hall"];

const manifest = JSON.parse(await readFile(resolve(DEMO_DIR, "manifest.json"), "utf8"));
const manifestById = new Map(manifest.projects.map((item) => [item.demoId, item]));

const problems = [];
const rows = [];

for (const name of NAMES) {
  const zip = unzipSync(new Uint8Array(await readFile(resolve(DEMO_DIR, `${name}.gujian.zip`))));
  const data = JSON.parse(new TextDecoder().decode(zip["project.json"]));
  const snapshot = data.snapshot;
  const say = (text) => problems.push(`${name}：${text}`);

  // 一、命令回执要覆盖包内每一条审计事件，否则导入后看不出每一步做了什么
  const receipts = data.commandReceipts ?? [];
  const receiptIds = new Set(receipts.map((item) => item.commandId));
  const uncovered = data.auditEvents.filter((event) => !receiptIds.has(event.commandId));
  if (uncovered.length) {
    say(`${uncovered.length} 条审计事件没有对应回执，导入后这些条目显示不出动作名。dist 落后于源码时最容易出现，先跑 tsc -b 再重建包`);
  }

  // 二、未解决的问题必须逐条出现在交付阻断里。数量对不上说明有问题被静默作废
  const openIssues = snapshot.issues.filter((issue) => issue.status === "open");
  const evaluation = data.deliveryEvaluations?.[0];
  if (!evaluation) {
    say("没有交付评估记录");
  } else {
    const openCodes = evaluation.blockerCodes.filter((code) => code.startsWith("OPEN_ISSUE"));
    if (openCodes.length !== openIssues.length) {
      say(`未解决问题 ${openIssues.length} 条，交付阻断里只有 ${openCodes.length} 条 OPEN_ISSUE。规则核对可能把未重新提出的问题一并作废了`);
    }
    for (const issue of snapshot.issues) {
      if (issue.status === "superseded" && !snapshot.issues.some((other) => (
        other.id !== issue.id
        && other.status === "open"
        && other.issueType === issue.issueType
        && [...other.subjectRefs].sort().join() === [...issue.subjectRefs].sort().join()
      ))) {
        say(`有一条已被替代的问题没有对应的新问题接替：${issue.description.slice(0, 30)}。被替代应当意味着有新版本，不是无声关闭`);
        break;
      }
    }
  }

  // 四、实施单元 09 起三个演示项目演示的是归档完成的项目：资料无缺失、问题为零、模型无待确认部位、
  //     交付草案带正式环境的复核签发记录。缺任何一项即为演示不成立。
  const missingEvidence = snapshot.evidences.filter((item) => item.dataStatus !== "available").length;
  if (missingEvidence) say(`有 ${missingEvidence} 份资料缺原件，演示项目应资料齐全`);
  if (openIssues.length) say(`有 ${openIssues.length} 条未关闭的问题，演示项目应全部关闭`);
  const latestSpec = snapshot.geometrySpecs?.at?.(-1);
  const signoff = (snapshot.reviewSignoffs ?? []).at?.(-1);
  if (!signoff) say("没有复核签发记录，演示项目应演示归档完成");
  else if (signoff.issuingEnvironment !== "formal") say("复核签发记录不是正式环境签发的");
  if (latestSpec && latestSpec.unknowns.length && !signoff) say(`模型有 ${latestSpec.unknowns.length} 处待确认部位且无复核签发`);

  // 三、清单计数与包内记录要对得上
  const expected = manifestById.get(name);
  if (!expected) {
    say("清单里没有这个项目");
  } else {
    const actual = {
      evidenceCount: snapshot.evidences.length,
      issueCount: snapshot.issues.length,
      factCount: snapshot.facts.length,
      artifactCount: (data.artifacts ?? []).length,
    };
    for (const [key, value] of Object.entries(actual)) {
      if (expected[key] !== value) say(`清单记 ${key} 为 ${expected[key]}，包里实际 ${value}`);
    }
    const missing = snapshot.evidences.filter((item) => item.dataStatus === "missing").length;
    if (expected.missingEvidenceCount !== missing) {
      say(`清单记缺失资料 ${expected.missingEvidenceCount} 份，包里实际 ${missing} 份`);
    }
  }

  // 四、代理交付草案必须带限制条款，空条款等于把代理成果说成可直接使用
  const draft = data.deliveries?.[0];
  if (!draft) say("没有交付草案");
  else if (!draft.restrictions?.length) say("交付草案没有限制条款");

  rows.push({
    name,
    审计: data.auditEvents.length,
    回执: receipts.length,
    未解决问题: openIssues.length,
    阻断码: evaluation?.blockerCodes.length ?? 0,
    待确认部位: latestSpec?.unknowns.length ?? 0,
    签发: signoff ? signoff.signedAt.slice(0, 10) : "无",
    成果: (data.artifacts ?? []).length,
    限制条款: draft?.restrictions?.length ?? 0,
  });
}

const width = (text) => [...String(text)].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
const pad = (text, size) => String(text) + " ".repeat(Math.max(0, size - width(text)));
const columns = ["name", "审计", "回执", "未解决问题", "阻断码", "待确认部位", "签发", "成果", "限制条款"];
console.log(columns.map((c) => pad(c === "name" ? "项目" : c, c === "name" ? 34 : 12)).join(""));
for (const row of rows) {
  console.log(columns.map((c) => pad(row[c], c === "name" ? 34 : 12)).join(""));
}

if (problems.length) {
  console.log("");
  for (const line of problems) console.log(`必须修复：${line}`);
  process.exit(1);
}
console.log("\n三个演示包内部一致");
