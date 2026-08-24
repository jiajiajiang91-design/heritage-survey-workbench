// 工作台十五屏截图：无头 Chrome 经 CDP 在 1440×900、设备像素比 2 下逐屏截图，供与 Figma 原型并排对照。
// 用法：node tools/workbench-screens.mjs <输出目录> [宽 高] [文件名前缀]
// 前提：开发服务器已起（http://localhost:5173），本机装有 Chrome。弹层与框选态不在此脚本内。
// 出处：实施单元 08 收口，证据见 文档/05_验证证据/17_十九屏重做/十九屏对照与实测.md
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("用法：node tools/workbench-screens.mjs <输出目录> [宽 高] [文件名前缀]"); process.exit(2); }
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const prefix = process.argv[5] ?? "";
mkdirSync(outDir, { recursive: true });
const profile = join(process.env.TEMP ?? ".", "gj-shoot-profile");
const port = 9333;
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome 未就绪");
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (msg) => (msg.error ? reject(new Error(method + ": " + JSON.stringify(msg.error))) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const shot = async (name) => {
  await sleep(400);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${prefix}${name}.png`), Buffer.from(r.data, "base64"));
  console.log("截图", name);
};
const waitFor = async (expression, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(200);
  }
  throw new Error("等待超时: " + expression);
};
// 点击按钮：按可见文字找 button/role=tab/a
const click = async (text, scope = "document") =>
  evaluate(`(() => {
    const nodes = [...(${scope}).querySelectorAll("button, [role=tab], a, label")];
    const el = nodes.find((n) => n.textContent.trim() === ${JSON.stringify(text)}) ?? nodes.find((n) => n.textContent.includes(${JSON.stringify(text)}));
    if (!el) return false; el.click(); return true;
  })()`);

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173/" });
await waitFor(`document.querySelectorAll("article.sc-project").length >= 3`, 60000);
await evaluate(`document.fonts.ready.then(() => true)`);
await sleep(800);
await shot("P01_项目列表");

// 进入 Dai Loy（第二张卡）
await evaluate(`(() => { const cards = [...document.querySelectorAll("article.sc-project")]; const card = cards.find((c) => c.textContent.includes("高都")) ?? cards[0]; const btn = [...card.querySelectorAll("button")].find((b) => b.textContent.includes("进入")); btn.click(); return true; })()`);
await waitFor(`!!document.querySelector(".ws-stage-nav")`);
await sleep(600);

const views = [
  ["建立任务", null, "W01_任务卡"],
  ["整理资料", null, "W02_资料清单"],
  ["核对实测", null, "W03_实测基准"],
  ["核对构件", "构件清单", "W04_构件清单"],
  ["核对构件", "三维模型", "W06_三维模型"],
  ["记录现状", "现状记录", "W05_现状记录"],
  ["记录现状", "问题队列", "W07_问题队列"],
  ["生成图纸", "图纸样式", "W08_图纸样式"],
  ["生成图纸", "成组图纸", "W08b_成组图纸"],
  ["检查签发", null, "W09_检查与签发"],
  ["交付归档", null, "W10_代理交付"],
];
for (const [stage, tab, name] of views) {
  await click(stage, `document.querySelector(".ws-stage-nav")`);
  await sleep(300);
  if (tab) { await click(tab, `(document.querySelector("[aria-label='工作区视图']") ?? document)`); await sleep(300); }
  await sleep(500);
  await shot(name);
  if (name === "W09_检查与签发") {
    if (await click("查看使用限制")) { await sleep(300); await shot("W09A_资格与限制"); await click("收起使用限制"); }
  }
}
// 项目级页面
await click("运行与用量", `document.querySelector(".ws-topbar")`); await sleep(600); await shot("P02_模型运行与用量");
await click("修改历史", `document.querySelector(".ws-topbar")`); await sleep(600); await shot("P03_修改历史");
// 回项目列表开新建对话框
await click("项目列表", `document.querySelector(".ws-topbar")`); await sleep(600);
if (await click("新建项目")) { await sleep(400); await shot("B01_新建任务"); await click("取消"); }

ws.close();
chrome.kill();
process.exit(0);
