import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { journeyStages, projectPages, stages } from "./App";

// 左栏的八阶段、中栏的页签行和顶栏的三个项目级页面，取值都必须与
// 01_产品/03_界面与交互形态.md 的表 2 表 3 对得上。
// 文档是唯一出处：改了界面不改文档，或改了文档不改界面，这里都会失败。

const DOC = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "文档", "01_产品", "03_界面与交互形态.md"),
  "utf8",
);

// 从 markdown 表格里取指定几列。表头行用来定位，分隔行与非表格行跳过。
function tableRows(heading: string, columns: string[]): string[][] {
  const start = DOC.indexOf(heading);
  expect(start, `文档里找不到 ${heading}`).toBeGreaterThan(-1);
  const lines = DOC.slice(start).split("\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("|"));
  const header = lines[headerIndex]!.split("|").slice(1, -1).map((cell) => cell.trim());
  const picks = columns.map((name) => {
    const index = header.indexOf(name);
    expect(index, `${heading} 里没有 ${name} 这一列`).toBeGreaterThan(-1);
    return index;
  });
  const rows: string[][] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.push(picks.map((index) => cells[index]!));
  }
  return rows;
}

const VIEW_ROWS = tableRows("**表 2：工作区视图**", ["阶段", "视图"]);
const PAGE_ROWS = tableRows("**表 3：项目级页面**", ["页面"]);
const labelOf = (id: string) => stages.find((stage) => stage.id === id)?.label;

describe("阶段与视图对得上界面文档", () => {
  it("八个阶段的名称与顺序与表 2 的阶段列一致", () => {
    const fromDoc: string[] = [];
    for (const [stage] of VIEW_ROWS) {
      if (fromDoc[fromDoc.length - 1] !== stage) fromDoc.push(stage!);
    }
    const fromCode = journeyStages.map((stage, index) => `${String(index + 1).padStart(2, "0")} ${stage.label}`);
    expect(fromCode).toEqual(fromDoc);
  });

  it("每个阶段下的视图名称与顺序与表 2 一致", () => {
    const fromDoc = new Map<string, string[]>();
    for (const [stage, view] of VIEW_ROWS) {
      fromDoc.set(stage!, [...(fromDoc.get(stage!) ?? []), view!]);
    }
    const fromCode = new Map(journeyStages.map((stage, index) => [
      `${String(index + 1).padStart(2, "0")} ${stage.label}`,
      stage.views.map((view) => labelOf(view)),
    ]));
    expect(Object.fromEntries(fromCode)).toEqual(Object.fromEntries(fromDoc));
  });

  it("三个项目级页面的名称与表 3 一致", () => {
    // 项目列表没有对应的视图 id，它是退出项目本身，只核对另外两个。
    const fromDoc = PAGE_ROWS.map(([page]) => page);
    expect(fromDoc).toContain("项目列表");
    expect(projectPages.map((id) => labelOf(id))).toEqual(fromDoc.filter((page) => page !== "项目列表"));
  });

  it("十三个视图不多不少，工作视图归阶段，其余归项目级页面", () => {
    const inStages = journeyStages.flatMap((stage) => stage.views as readonly string[]);
    const all = [...inStages, ...projectPages];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(stages.map((stage) => stage.id).slice().sort());
  });
});

describe("视图 id 是稳定标识", () => {
  // 助手动作层按 id 切换视图，演示脚本与用例里也写着这些 id。
  // 改名只改 label，改 id 会让已经录好的动作失效，因此这份清单写死。
  it("十三个 id 与既有清单逐字相同", () => {
    expect(stages.map((stage) => stage.id)).toEqual([
      "tasks", "evidence", "measurements", "objects", "conditions", "issues", "geometry",
      "sheetStyle", "drawings", "checks", "package", "candidates", "history",
    ]);
  });

  it("八个阶段 id 按序编号", () => {
    expect(journeyStages.map((stage) => stage.id)).toEqual(
      ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08"],
    );
  });
});
