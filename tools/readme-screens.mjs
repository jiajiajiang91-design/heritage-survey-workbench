// README 用的六张精选截图：无头 Chrome 打公网站点，1440×900、设备像素比 2，存 PNG。
// 用法：node tools/readme-screens.mjs [输出目录] [站点地址]
// 助手问答一张要真连模型，站点侧有每日限额，脚本一次只问一句。
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "docs/readme-assets";
const site = process.argv[3] ?? "https://heritage.jiajiajiang.com/";
mkdirSync(outDir, { recursive: true });
const profile = join(process.env.TEMP ?? ".", "gj-readme-shoot");
const port = 9337;
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--window-size=1440,900", "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 未就绪继续等 */ }
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
  await sleep(500);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, "base64"));
  console.log("截图", name);
};
const waitFor = async (expression, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(300);
  }
  throw new Error("等待超时: " + expression);
};
const click = async (text, scope = "document") =>
  evaluate(`(() => {
    const nodes = [...(${scope}).querySelectorAll("button, [role=tab], a, label")];
    const el = nodes.find((n) => n.textContent.trim() === ${JSON.stringify(text)}) ?? nodes.find((n) => n.textContent.includes(${JSON.stringify(text)}));
    if (!el) return false; el.click(); return true;
  })()`);

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: site });
// 首次装载要下载三个演示包，公网给足时间
await waitFor(`document.querySelectorAll("article.sc-project").length >= 3`, 300000);
await evaluate(`document.fonts.ready.then(() => true)`);
await sleep(1000);
// 关掉装载完成的提示条再截
await evaluate(`(() => { [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "×" || b.getAttribute("aria-label") === "关闭").forEach((b) => b.click()); return true; })()`);
await sleep(400);
await shot("01_项目列表");

// 进高都
await evaluate(`(() => { const card = [...document.querySelectorAll("article.sc-project")].find((c) => c.textContent.includes("高都")); [...card.querySelectorAll("button")].find((b) => b.textContent.includes("进入")).click(); return true; })()`);
await waitFor(`!!document.querySelector(".ws-stage-nav")`);
await sleep(800);

// 三维模型（等画布出模型）
await click("核对构件", `document.querySelector(".ws-stage-nav")`);
await sleep(400);
await click("三维模型", `(document.querySelector("[aria-label='工作区视图']") ?? document)`);
await waitFor(`!!document.querySelector(".sc-model-canvas canvas")`, 60000);
await sleep(2500);
await shot("02_三维模型");

// 成组图纸（默认第一张 SVG 预览）
await click("生成图纸", `document.querySelector(".ws-stage-nav")`);
await sleep(400);
await click("成组图纸", `(document.querySelector("[aria-label='工作区视图']") ?? document)`);
await waitFor(`!!document.querySelector(".gj-viewer img, .gj-viewer canvas, .gj-viewer-dxf")`, 30000);
await sleep(1200);
await shot("03_成组图纸");

// 检查与签发
await click("检查签发", `document.querySelector(".ws-stage-nav")`);
await sleep(1500);
await shot("04_检查与签发");

// 实测基准（含形制对照表）
await click("核对实测", `document.querySelector(".ws-stage-nav")`);
await sleep(1200);
await shot("05_实测基准");

// 助手问答：真连模型，问一句等回答
await evaluate(`(() => {
  const input = document.querySelector(".assistant-input-row textarea");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, "这个项目的通面阔是多少？");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(300);
await evaluate(`(() => { [...document.querySelectorAll(".assistant-input-row button")].find((b) => b.textContent.includes("发送")).click(); return true; })()`);
await waitFor(`(document.querySelector(".ws-assistant")?.innerText ?? "").includes("9600")`, 60000);
await sleep(600);
await shot("06_AI助手");

ws.close();
chrome.kill();
process.exit(0);
