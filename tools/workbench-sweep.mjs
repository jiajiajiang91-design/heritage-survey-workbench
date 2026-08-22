// 工作台逐屏巡检：无头 Chrome 经 CDP 进入每个演示项目，走十一个工作视图与两个项目级页面，
// 查占位词与控制台错误，读字体，每屏存一张缩略截图，结果写 巡检结果.json。
// 用法：node tools/workbench-sweep.mjs <输出目录> [开发服务器地址]
// 前提：开发服务器已起（默认 http://localhost:5173），本机装有 Chrome。
// 出处：实施单元 08 收口，证据见 文档/05_验证证据/17_十九屏重做/十九屏对照与实测.md
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const outDir = process.argv[2];
const origin = process.argv[3] ?? "http://localhost:5173";
if (!outDir) { console.error("用法：node tools/workbench-sweep.mjs <输出目录> [开发服务器地址]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const profile = join(process.env.TEMP ?? ".", "gj-shoot-profile");
const port = 9336;
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,900", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url; for (let i = 0; i < 40 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(250); }
const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? "exception"); else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" ")); };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => m.error ? rej(new Error(method + JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const waitFor = async (expr, timeout = 30000) => { const t = Date.now(); while (Date.now() - t < timeout) { if (await evaluate(expr)) return true; await sleep(200); } return false; };
const click = (text, scope = "document") => evaluate(`(() => { const nodes = [...(${scope}).querySelectorAll("button, [role=tab], a, label")]; const el = nodes.find((n) => n.textContent.trim() === ${JSON.stringify(text)}) ?? nodes.find((n) => n.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: origin + "/" });
await waitFor(`document.querySelectorAll("article.sc-project").length >= 3`, 60000);
const fonts = await evaluate(`document.fonts.ready.then(() => ({ noto: document.fonts.check("13px 'Noto Sans SC Variable'"), geist: document.fonts.check("13px 'Geist Variable'"), loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family) }))`);
const projects = await evaluate(`[...document.querySelectorAll("article.sc-project .sc-project-name")].map((n) => n.textContent.trim())`);
const views = [["建立任务", null, "W01"], ["整理资料", null, "W02"], ["核对实测", null, "W03"], ["核对构件", "构件清单", "W04"], ["核对构件", "三维模型", "W06"], ["记录现状", "现状记录", "W05"], ["记录现状", "问题队列", "W07"], ["生成图纸", "图纸样式", "W08"], ["生成图纸", "成组图纸", "W08b"], ["检查签发", null, "W09"], ["交付归档", null, "W10"]];
const report = { fonts, projects: [], consoleErrors: [] };
const BAD = /undefined|NaN|\[object Object\]|null\b/;
for (const name of projects) {
  await click("项目列表", `(document.querySelector(".ws-topbar") ?? document)`); await sleep(300);
  await waitFor(`document.querySelectorAll("article.sc-project").length >= 3`);
  await evaluate(`(() => { const card = [...document.querySelectorAll("article.sc-project")].find((c) => c.querySelector(".sc-project-name").textContent.trim() === ${JSON.stringify(name)}); [...card.querySelectorAll("button")].find((b) => b.textContent.includes("进入")).click(); return true; })()`);
  await waitFor(`!!document.querySelector(".ws-stage-nav")`); await sleep(800);
  const entry = { name, views: [] };
  for (const [stage, tab, code] of views) {
    await click(stage, `(document.querySelector(".ws-stage-nav") ?? document)`); await sleep(250);
    if (tab) { await click(tab, `(document.querySelector("[aria-label='工作区视图']") ?? document)`); await sleep(250); }
    await sleep(500);
    const info = await evaluate(`(() => { const c = document.querySelector(".ws-center"); const text = c ? c.innerText : ""; return { title: document.querySelector(".ws-page-title")?.textContent, chars: text.length, bad: (text.match(${BAD.toString()}g) || []).slice(0, 3), empty: !!c && c.innerText.trim().length < 40 }; })()`);
    entry.views.push({ code, ...info });
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    writeFileSync(join(outDir, `${name.slice(0, 8)}_${code}.jpg`), Buffer.from(r.data, "base64"));
  }
  for (const page of ["模型运行与用量", "修改历史"]) {
    await click(page, `(document.querySelector(".ws-topbar") ?? document)`); await sleep(500);
    const info = await evaluate(`(() => { const c = document.querySelector("main, .ws-page, .ws-body"); const text = c ? c.innerText : document.body.innerText; return { title: document.querySelector(".ws-page-title")?.textContent, chars: text.length, bad: (text.match(${BAD.toString()}g) || []).slice(0, 3) }; })()`);
    entry.views.push({ code: page, ...info });
  }
  report.projects.push(entry);
}
report.consoleErrors = consoleErrors.slice(0, 20);
// 抽查样式（最后一个项目的当前页：修改历史）；再回到工作区抽查标题、页签、标签、卡片、主按钮
await click("回到", `document.querySelector(".ws-back") ?? document`); await sleep(400);
report.styles = await evaluate(`(() => { const g = (sel, props) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, cs[p]])); }; return {
  pageTitle: g(".ws-page-title", ["fontSize", "lineHeight", "fontWeight", "fontFamily", "color"]),
  pageDesc: g(".ws-page-desc", ["fontSize", "lineHeight", "color"]),
  tabActive: g("[aria-label='工作区视图'] [aria-current]", ["height", "borderRadius", "backgroundColor", "fontSize"]),
  paneTitle: g(".gj-pane-title", ["fontSize", "lineHeight", "fontWeight"]),
  tag: g(".gj-tag", ["fontSize", "lineHeight", "height", "borderRadius"]),
  card: g(".gj-list-card, .gj-card", ["borderRadius", "borderWidth", "borderColor", "boxShadow"]),
  primaryBtn: g(".gj-btn--primary", ["height", "borderRadius", "backgroundColor", "color", "fontSize", "paddingLeft"]),
  rail: g(".ws-rail", ["width"]), stageRow: g(".ws-stage-nav button", ["height", "fontSize"]), topbar: g(".ws-topbar", ["height"]),
  assistant: g(".ws-assistant", ["width"]), body: g("body", ["fontFamily"]), numeric: g(".gj-numeric", ["fontFamily"]),
}; })()`);
writeFileSync(join(outDir, "巡检结果.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.fonts)); for (const p of report.projects) for (const v of p.views) if (v.bad.length || v.empty) console.log("异常", p.name, v.code, v.bad, v.empty);
console.log("控制台错误", report.consoleErrors.length); console.log(JSON.stringify(report.styles, null, 1));
ws.close(); chrome.kill(); process.exit(0);
