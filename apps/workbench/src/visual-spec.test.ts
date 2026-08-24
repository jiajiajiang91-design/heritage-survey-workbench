import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// 07 界面视觉规范第 8 节自检清单里可自动化的条目。
// 目的是防回归：色值、字号与圆角一旦绕过令牌，测试立即失败。

const SOURCE_ROOT = import.meta.dirname;
const read = (name: string) => readFileSync(join(SOURCE_ROOT, name), "utf8");

// 扫描 src 下全部样式文件（令牌文件除外）。单元 08 起页面样式按屏分文件，
// 只读两份固定文件会让新文件里的字面值漏检。
function cssFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test") continue;
      collected.push(...cssFiles(full));
    } else if (entry.name.endsWith(".css") && entry.name !== "tokens.css") {
      collected.push(relative(SOURCE_ROOT, full).split("\\").join("/"));
    }
  }
  return collected.sort();
}
const STYLE_FILES = cssFiles(SOURCE_ROOT).map((name) => [name, read(name)] as const);

const TOKENS = read("tokens.css");
const COMPONENTS = read("components.css");
const evidence = (name: string) =>
  readFileSync(join(SOURCE_ROOT, "..", "..", "..", "文档", "05_验证证据", "15_外壳与令牌", name), "utf8");
const TOKEN_LIST = evidence("令牌取值清单.md");
const GAP_LIST = evidence("字面值缺口清单.md");

// tokens.css 分两段：上半段是取自 Figma 的 148 个新令牌，下半段是正在退场的
// v1.0 旧令牌。锁定只针对上半段，旧令牌随第二组的引用迁移逐步删除。
const NEW_TOKENS = TOKENS.split("以下是视觉规范 v1.0 的旧令牌")[0] ?? "";
const declaredNames = (css: string) => new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!));

describe("令牌与 Figma 设计系统一致（实施单元 06 第一组）", () => {
  // 令牌与清单对不上时，实现就会开始各写各的。这条锁双向：缺一条或多一条都不通过。
  it("tokens.css 的新令牌与取值清单逐条相等", () => {
    const inCss = declaredNames(NEW_TOKENS);
    const inList = new Set([...TOKEN_LIST.matchAll(/^\| `(--[a-z0-9-]+)`/gm)].map((m) => m[1]!));
    const missing = [...inList].filter((name) => !inCss.has(name)).sort();
    const extra = [...inCss].filter((name) => !inList.has(name)).sort();
    expect(missing, "清单里有而 tokens.css 里没有").toEqual([]);
    expect(extra, "tokens.css 里有而清单里没有，来路不明的令牌不许留").toEqual([]);
    // 总数从清单正文里读，不写死：写死会在增删令牌时变成第三处要同步的地方
    const declared = Number(/合计 (\d+) 条/.exec(TOKEN_LIST)?.[1]);
    expect(declared, "清单末尾要写明合计条数").toBeGreaterThan(0);
    expect(inCss.size).toBe(declared);
  });

  // 语义层摊平成字面色值就失去了改一处色阶全跟着变的作用，也与 Figma 的别名结构脱节
  it("语义层只以 var 指向色阶，不写字面色值", () => {
    const semantic = NEW_TOKENS.split("Semantic Color")[1]?.split("Geometry（")[0] ?? "";
    const literals = [...semantic.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/gm)].map((m) => m[1]!);
    expect(literals, "语义令牌应写成 var(--色阶名)").toEqual([]);
  });
});

// 第二组：已经改成令牌引用的地方不许再退回字面值。
// 这三条只管 var() 引用的合法性，不管还剩多少字面值，后者由缺口清单管。
describe("令牌引用只取档位内的值（实施单元 06 第二组）", () => {
  // 不用模板字符串拼正则：模板会先吃掉一层反斜杠，`var\(` 变成 `var(`，
  // 那个括号被当成分组，正则永远匹配不到，六条校验全部空转。
  // 2026-08-22 实测过：塞一个不存在的令牌照样通过，所以改成写死的正则再按前缀筛。
  const referenced = (css: string, prefix: string) =>
    [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))]
      .filter((token) => token.startsWith(prefix));
  const declared = new Set([...TOKENS.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!));

  for (const [label, prefix] of [["间距", "--space-"], ["圆角", "--radius-"], ["描边", "--stroke-"],
    ["字号", "--font-size-"], ["行高", "--line-"], ["字重", "--font-weight-"]] as const) {
    it(`${label}只引用已声明的令牌`, () => {
      for (const [name, css] of STYLE_FILES) {
        const unknown = referenced(css, prefix).filter((token) => !declared.has(token));
        expect(unknown, `${name} 引用了未声明的${label}令牌`).toEqual([]);
      }
    });
  }
});

// 剩余的字面值必须条条有交代。数量对不上说明有人新写了字面值，
// 或者删了字面值没同步清单，两种都要查出来。
describe("剩余字面值与缺口清单对得上（实施单元 06 第二组）", () => {
  // 按文件逐行对账。清单里每个样式文件一行，写作“| `文件名` | 数量 |”；
  // 新文件从 0 起，旧文件只减不增，删光的文件从清单里整行删除。
  it("每份样式里的字面 px 数量与清单记的数量逐文件相等", () => {
    // 注释里提到的尺寸不算实现里的字面值，先剥掉注释再数
    const count = (css: string) =>
      css.replace(/\/\*[\s\S]*?\*\//g, "").match(/(?<![\w.-])\d+(?:\.\d+)?px/g)?.length ?? 0;
    const recorded = new Map([...GAP_LIST.matchAll(/^\| `([^`]+\.css)` \| (\d+) \|/gm)].map((m) => [m[1]!, Number(m[2])]));
    expect(recorded.size, "缺口清单要按文件写明当前值").toBeGreaterThan(0);
    const actual = new Map(STYLE_FILES.map(([name, css]) => [name, count(css)]));
    const mismatches: string[] = [];
    for (const [name, value] of actual) {
      const expected = recorded.get(name);
      if (expected === undefined) { if (value > 0) mismatches.push(`${name} 有 ${value} 处字面 px 但清单没有这一行`); continue; }
      if (expected !== value) mismatches.push(`${name} 实际 ${value} 处，清单记 ${expected} 处`);
    }
    for (const name of recorded.keys()) if (!actual.has(name)) mismatches.push(`清单里的 ${name} 已不存在`);
    expect(mismatches, "字面 px 数量与缺口清单对不上，新增了未记录的字面值就会在这里失败").toEqual([]);
  });

  // 单元 08 收口后清单进入终态：不再分甲乙丙丁四类，改为逐文件写明每处的出处。
  // 有字面值的文件都要在第二节出现，删光的文件不写。
  it("缺口清单第二节逐文件写了每处字面值的出处", () => {
    const section = GAP_LIST.slice(GAP_LIST.indexOf("## 二、逐条"), GAP_LIST.indexOf("## 三、校验方式"));
    const count = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").match(/(?<![\w.-])\d+(?:\.\d+)?px/g)?.length ?? 0;
    for (const [name, css] of STYLE_FILES) {
      if (count(css) === 0) continue;
      const stem = name.replace(/^screens\//, "").replace(/\.css$/, "");
      expect(section, `缺口清单第二节没写 ${name}`).toContain(stem);
    }
  });
});

describe("界面视觉规范自检（07 第 8 节）", () => {
  it("令牌覆盖第 2 节色板与第 6 节版面尺寸", () => {
    const required = [
      "--bg-canvas", "--bg-surface", "--bg-subtle", "--bg-selected", "--bg-scrim",
      "--text-primary", "--text-secondary", "--text-tertiary", "--text-link",
      "--border-subtle", "--border-default", "--border-strong", "--border-focus",
      "--action-primary-bg", "--action-primary-fg", "--action-danger-bg",
      "--text-success", "--text-warning", "--text-danger",
      "--source-measured-fg", "--source-ai-fg", "--source-rule-fg", "--source-human-fg", "--source-demo-fg",
      "--layout-topbar-height", "--layout-left-rail", "--layout-center-min", "--layout-assistant-panel",
    ];
    for (const token of required) expect(TOKENS, `缺令牌 ${token}`).toContain(`${token}:`);
  });

  // v1.0 的旧令牌 2026-08-22 已从 tokens.css 删除，引用全部迁到新令牌。
  // 再出现说明有人把旧名字写回来了，或者从别的分支合进了未迁的样式。
  it("样式里不再引用已退场的 v1.0 令牌", () => {
    const retired = [
      "--accent", "--accent-soft", "--accent-hover", "--accent-active", "--on-accent",
      "--bg-page", "--bg-panel", "--border", "--text-muted",
      "--success", "--warning", "--danger", "--success-soft", "--warning-soft", "--danger-soft",
      "--src-measured", "--src-model", "--src-rule", "--src-human", "--src-demo",
      "--radius-panel", "--radius-control", "--radius-pill", "--overlay-shadow",
      "--topbar-height", "--left-column", "--left-item-height", "--center-min", "--right-column",
      "--control-height", "--row-height", "--header-row-height",
      "--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8",
      "--text-title", "--text-section", "--text-body", "--text-note", "--text-numeric", "--text-label",
      "--font-sans", "--font-mono",
    ];
    for (const [name, css] of [...STYLE_FILES, ["tokens.css", TOKENS] as const]) {
      const found = retired.filter((token) => css.includes(`var(${token})`) || css.includes(`  ${token}:`));
      expect(found, `${name} 里还有已退场的 v1.0 令牌`).toEqual([]);
    }
  });

  it("页面与组件样式不写字面色值", () => {
    for (const [name, css] of STYLE_FILES) {
      const literals = [...new Set([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]))];
      expect(literals, `${name} 出现规范外色值，应改用第 2 节令牌`).toEqual([]);
    }
  });

  it("不使用 12px 以下字号", () => {
    for (const [name, css] of STYLE_FILES) {
      const sizes = [...css.matchAll(/font(?:-size)?:[^;{}]*?\b(\d+)px/g)].map((match) => Number(match[1]));
      const tooSmall = [...new Set(sizes.filter((size) => size < 12))];
      expect(tooSmall, `${name} 出现 12px 以下字号`).toEqual([]);
    }
  });

  it("基础组件齐备，页面不另写一套", () => {
    // 第 5 节六类：按钮、表格、卡片、标签、输入表单、空态
    for (const component of [".gj-btn", ".gj-table", ".gj-card", ".gj-tag", ".gj-field", ".gj-empty"]) {
      expect(COMPONENTS, `缺基础组件 ${component}`).toContain(component);
    }
    // 按钮四类与五状态
    for (const variant of ["--primary", "--secondary", "--text", "--danger"]) {
      expect(COMPONENTS, `按钮缺 ${variant}`).toContain(`.gj-btn${variant}`);
    }
    for (const state of [":hover", ":active", ":disabled", "aria-busy", ":focus-visible"]) {
      expect(COMPONENTS, `按钮缺状态 ${state}`).toContain(state);
    }
  });

  it("来源标记五类齐全，各有专属令牌，不只靠颜色", () => {
    // 口径 2026-08-22 改为颜色加文字，不用形状，见裁决记录第七节第 3 条。
    // 这条现在锁两件事：五类各有自己的语义令牌，以及标记始终带文字。
    for (const kind of ["measured", "model", "rule", "human", "demo"]) {
      expect(COMPONENTS, `来源标记缺 ${kind}`).toContain(`.gj-source--${kind}`);
    }
    for (const token of ["--source-measured-fg", "--source-ai-fg", "--source-rule-fg",
      "--source-human-fg", "--source-demo-fg"]) {
      expect(COMPONENTS, `来源标记未引用 ${token}`).toContain(token);
    }
    // 形状已取消，旧的斜线底纹与圆点不许留在实现里
    for (const [, css] of STYLE_FILES) expect(css).not.toContain("repeating-linear-gradient");
  });

  it("窄屏断点与版面令牌对得上", () => {
    // 媒体查询里用不了 var()，边界写的是字面值。这条把它与令牌绑住：
    // 断点写的必须是令牌值减一，改了令牌不改媒体查询就会在这里失败。
    // 不用模板字符串拼正则：模板里的反斜杠会先被字符串吃掉一层，\s 变成字面 s
    const tokenValue = (name: string) => {
      const line = TOKENS.split("\n").find((row) => row.trim().startsWith(`${name}:`));
      return Number(/(\d+)px/.exec(line ?? "")?.[1]);
    };
    const lg = tokenValue("--layout-breakpoint-lg");
    const md = tokenValue("--layout-breakpoint-md");
    expect(lg, "缺 --layout-breakpoint-lg").toBeGreaterThan(0);
    expect(md, "缺 --layout-breakpoint-md").toBeGreaterThan(0);
    const allCss = STYLE_FILES.map(([, css]) => css).join("\n");
    expect(allCss, `断点应为 max-width: ${lg - 1}px`).toContain(`@media (max-width: ${lg - 1}px)`);
    expect(allCss, `断点应为 max-width: ${md - 1}px`).toContain(`@media (max-width: ${md - 1}px)`);
  });

  it("v4 没有阴影，实现里也不留投影与模糊", () => {
    for (const [name, css] of STYLE_FILES) {
      expect(css, `${name} 出现 backdrop-filter，v4 的浮层是平的`).not.toContain("backdrop-filter");
      // 先取出值再判，不靠正则里的否定前瞻：\s* 会回溯到空格处让前瞻落空。
      // 内阴影与 0 0 0 起手的焦点环属描边性质，保留；有偏移量的投影一律不留。
      const drops = [...css.matchAll(/box-shadow:([^;]*)/g)]
        .map((m) => m[1]!.trim())
        .filter((value) => !value.startsWith("inset") && !value.startsWith("0 0 0"));
      expect(drops, `${name} 出现投影，v4 十九屏一个阴影都没有`).toEqual([]);
    }
  });

  it("布局按第 6 节取值，焦点样式不移除", () => {
    // 三栏改走 layout 段令牌，旧的 --left-column 等随旧令牌一并退场
    const allCss = STYLE_FILES.map(([, css]) => css).join("\n");
    for (const token of ["--layout-left-rail", "--layout-center-min", "--layout-assistant-panel"]) {
      expect(allCss, `三栏未引用 ${token}`).toContain(`var(${token})`);
    }
    // 焦点环改走令牌后这里不再写死 2px，改为断言引用了强调描边令牌，
    // 取值仍锁在令牌那一侧：--stroke-emphasis 必须是 2px。基础重置在组件样式里。
    expect(COMPONENTS).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*var\(--stroke-emphasis\) solid/);
    expect(TOKENS).toMatch(/--stroke-emphasis:\s*2px/);
  });

  // 表 7 加载分档：三档表现各自成立，且不伪造百分比
  it("加载分档三档齐全", () => {
    // 第一档由 useDelayedIndicator 的 300 ms 门槛实现，见 LongTask.tsx
    expect(read("LongTask.tsx")).toContain("INDICATOR_DELAY_MS = 300");
    // 第二档：区域内 24 px 指示器加一行说明
    expect(COMPONENTS).toContain(".gj-loading");
    expect(COMPONENTS).toMatch(/\.gj-loading::before[\s\S]*?width: 24px/);
    // 第三档：进度条高 4 px、全圆角（v4 助手面板进度条 36:25），含不确定态
    expect(COMPONENTS).toMatch(/\.gj-task-bar \{[\s\S]*?height: 4px/);
    expect(COMPONENTS).toMatch(/\.gj-task-bar \{[\s\S]*?border-radius: var\(--radius-full\)/);
    expect(COMPONENTS).toContain(".gj-task-bar--indeterminate");
    expect(COMPONENTS).toContain(".gj-task-bar--determinate");
  });

  it("按钮加载态为 16 px 指示器且宽度不跳动", () => {
    // 指示器槽位常驻并预留宽度，进入加载态只切换可见性，宽度不变
    expect(COMPONENTS).toMatch(/\.gj-btn--loadable::before \{[\s\S]*?width: 16px/);
    expect(COMPONENTS).toMatch(/\.gj-btn--loadable::before \{[\s\S]*?visibility: hidden/);
    expect(COMPONENTS).toMatch(/\.gj-btn\[aria-busy="true"\]::before \{[\s\S]*?width: 16px/);
    // 动画 0.8 s 匀速，不用跳动或缩放
    expect(COMPONENTS).toMatch(/animation: gj-spin \.8s linear infinite/);
  });

  it("长任务不伪造百分比也不伪造估算值", () => {
    const source = read("LongTask.tsx");
    // 没有历史数据时显示耗时未知
    expect(source).toContain("耗时未知");
    // 预计耗时不精确到秒以下
    expect(source).toContain("预计还需");
    expect(source).not.toMatch(/toFixed\(\d\)/);
  });

});
