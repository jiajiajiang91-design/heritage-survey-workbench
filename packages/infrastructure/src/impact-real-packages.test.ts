import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildDependencyGraph, computeImpact, type ImpactGraphInput } from "@gujian/application";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";

// 拿三个演示包的真实数据验影响范围，不用构造的夹具。
// 构造的夹具只能证明算法按我写的方式工作，证明不了它在真实数据上算得对：
// 单元 07 开工前的探测就是在真实包上查出 factRefs 存两种东西的。

const DEMO_DIR = resolve(import.meta.dirname, "..", "..", "..", "apps", "workbench", "public", "demo");

async function loadPackage(name: string): Promise<ImpactGraphInput> {
  const zip = unzipSync(new Uint8Array(await readFile(resolve(DEMO_DIR, `${name}.gujian.zip`))));
  const data = JSON.parse(new TextDecoder().decode(zip["project.json"] as Uint8Array));
  return {
    snapshot: data.snapshot,
    artifacts: data.artifacts ?? [],
    requirementMatrices: data.artifactRequirementMatrices ?? [],
    checkRuns: data.checkRuns ?? [],
    deliveryEvaluations: data.deliveryEvaluations ?? [],
    deliveries: data.deliveries ?? [],
  };
}

// dai-loy 已从演示库下架（2026-08-25）；全链无缺口的情形由 impact-service.test.ts 的 fullChain 合成用例覆盖
const NAMES = ["gaodu-yuhuang-temple-main-hall", "t0b-construction-sample"] as const;
const packages: Record<string, ImpactGraphInput> = {};

beforeAll(async () => {
  for (const name of NAMES) packages[name] = await loadPackage(name);
});

describe("三个演示包都能建图", () => {
  it.each(NAMES)("%s 的边数大于零", (name) => {
    const graph = buildDependencyGraph(packages[name] as ImpactGraphInput);
    const edgeCount = [...graph.downstream.values()].reduce((sum, set) => sum + set.size, 0);
    expect(edgeCount).toBeGreaterThan(0);
  });

  // 三个包的几何上游留痕各不相同，这是包的事实不是算法的输出。
  // 数字变了说明演示包重建过，要回去核对而不是改这里的期望值。
  it("高都的几何引用形制参数，2243 处，没有无法解析的引用", () => {
    const graph = buildDependencyGraph(packages["gaodu-yuhuang-temple-main-hall"] as ImpactGraphInput);
    // 实施单元 09 重建演示包后实测 2243（补齐山面、飞椽、门窗判明后构件与参数变多）
    expect(graph.archetypeRefCount).toBe(2243);
    expect(graph.unresolvedRefCount).toBe(0);
  });

  it("t0b 的几何引用包外的 v3 构件 id，1258 处，计入无法解析", () => {
    const graph = buildDependencyGraph(packages["t0b-construction-sample"] as ImpactGraphInput);
    expect(graph.archetypeRefCount).toBe(0);
    expect(graph.unresolvedRefCount).toBe(1258);
  });


  // 出图要求是一类真实记录，存在包顶层而不在快照里。漏索引它会让 12 至 16 处
  // 成果的 sourceRefs 显示成无法解析，而它其实是任务要求到图纸这一段的中间环节。
  it.each(NAMES)("%s 的出图要求进了图，几何版本到出图要求有边", (name) => {
    const input = packages[name] as ImpactGraphInput;
    expect(input.requirementMatrices.length).toBeGreaterThan(0);
    const graph = buildDependencyGraph(input);
    const matrix = input.requirementMatrices[0]!;
    expect([...(graph.downstream.get(matrix.geometryRevisionId) ?? [])]).toContain(matrix.id);
  });

  it("改任务书时结果说明任务要求到图纸那一段算不出来", () => {
    const input = packages["gaodu-yuhuang-temple-main-hall"] as ImpactGraphInput;
    const task = input.snapshot.taskDefinitions[0];
    expect(task).toBeDefined();
    const result = computeImpact(input, [task!.id]);
    expect(result.coverageGaps.join()).toContain("任务书与出图要求之间没有相互引用的记录");
  });
});

describe("从资料出发的闭包（验收第 6 条）", () => {
  // 期望值先用独立脚本在包上算过一遍，再与实现对，不是把实现的输出抄回来当期望。
  // 脚本算出 35 / 33 / 74，实现算出 36 / 34 / 75，差的正好是每个包各一条出图要求记录，
  // 那一类脚本没算进去。差值有出处才认，对不上要回去查而不是改这里。
  // 实施单元 09 重建演示包后实测：高都第一条资料由识别记录换成正立面照片，闭包 30；
  // 复查补入现状记录后 32（石柱、油饰两条现状记录引用正立面照片，各占一条下游）
  const EXPECTED: Record<string, number> = {
    "gaodu-yuhuang-temple-main-hall": 32,
    "t0b-construction-sample": 75,
  };

  it.each(NAMES)("%s 改第一条资料的闭包条数与实测一致", (name) => {
    const input = packages[name] as ImpactGraphInput;
    const first = input.snapshot.evidences[0];
    expect(first).toBeDefined();
    const result = computeImpact(input, [first!.id]);
    expect(result.total + result.preserved.reduce((sum, group) => sum + group.count, 0)).toBe(EXPECTED[name]);
  });

  it.each(NAMES)("%s 的闭包覆盖从事实到交付草案七类", (name) => {
    const input = packages[name] as ImpactGraphInput;
    const result = computeImpact(input, [(input.snapshot.evidences[0] as { id: string }).id]);
    const kinds = [...result.groups, ...result.preserved].map((group) => group.kind);
    for (const kind of ["尺寸记录", "模型规格", "模型版本", "出图要求", "成果", "检查", "交付评估", "交付草案"] as const) {
      expect(kinds, `${name} 缺 ${kind}`).toContain(kind);
    }
  });
});

describe("从事实出发要看是哪条事实（验收第 6a、6b 条）", () => {

  it("高都的几何全部来自形制推算，改任一事实闭包为空且结果说明算不全", () => {
    const input = packages["gaodu-yuhuang-temple-main-hall"] as ImpactGraphInput;
    for (const fact of input.snapshot.facts) {
      const result = computeImpact(input, [fact.id]);
      expect(result.total, `${fact.field} 不该有下游`).toBe(0);
      expect(result.coverageGaps.join()).toContain("取自形制推算");
    }
  });

  it("t0b 的几何引用包外记录，改任一事实闭包为空且结果说明有引用找不到", () => {
    const input = packages["t0b-construction-sample"] as ImpactGraphInput;
    for (const fact of input.snapshot.facts) {
      const result = computeImpact(input, [fact.id]);
      expect(result.total, `${fact.field} 不该有下游`).toBe(0);
      expect(result.coverageGaps.join()).toContain("找不到对应记录");
    }
  });

});

describe("依赖边字段恒为空（验收第 14 条）", () => {
  it.each(NAMES)("%s 的 dependencyEdges 是空数组", (name) => {
    expect((packages[name] as ImpactGraphInput).snapshot.dependencyEdges).toEqual([]);
  });

  // 依赖图按推导得出。再往这个字段里写就有两个真相，且不同步时错得看不出来。
  // 扫源码而不是只看数据：数据现在是空的，挡不住以后有人加一条写入路径。
  it("源码里没有一处往 dependencyEdges 写非空值", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = resolve(import.meta.dirname, "..", "..", "..");
    const skip = new Set(["node_modules", "dist", ".git", "coverage", ".turbo", "文档"]);
    const allowed = /^(\[\]|z\.array|readonly)/;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.[cm]?[jt]sx?$/.test(name)) continue;
        for (const line of readFileSync(full, "utf8").split("\n")) {
          const match = /dependencyEdges\s*:\s*(\S.*)$/.exec(line);
          if (!match) continue;
          if (allowed.test(match[1]!.trim())) continue;
          hits.push(`${name}: ${line.trim().slice(0, 80)}`);
        }
      }
    };
    walk(root);
    expect(hits, "依赖边只能推导，不能写入").toEqual([]);
  });
});
