import type { ProjectPackageService } from "@gujian/infrastructure";

// 首次打开时装载演示项目。走的是用户导入项目包的同一条路径，
// 不另建代码分支，也不在界面里临时构造数据（08 演示项目定义 4、6）。
//
// 清单与包由 tools/build-demo-library.mjs 生成，前端不认识任何具体项目名，
// 项目名、限制说明都从清单读（技术架构 8.1）。

export interface DemoLibraryEntry {
  readonly demoId: string;
  readonly fileName: string;
  readonly projectName: string;
  readonly limitationZh: string;
  readonly projectId: string;
  readonly packageSha256: string;
}

export interface DemoLibraryManifest {
  readonly schemaVersion: string;
  readonly projects: readonly DemoLibraryEntry[];
}

export interface DemoLoadResult {
  readonly loaded: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { demoId: string; reason: unknown }[];
}

const MANIFEST_URL = "demo/manifest.json";

async function fetchManifest(base: string): Promise<DemoLibraryManifest | null> {
  const response = await fetch(`${base}${MANIFEST_URL}`);
  if (!response.ok) return null;
  const value = await response.json() as DemoLibraryManifest;
  if (!Array.isArray(value?.projects)) return null;
  return value;
}

// 同一次会话内只跑一次。开发模式下 effect 会执行两遍，两次并发导入同一个包
// 会在写入时撞键，表现为一半成功一半报错。
let inFlight: Promise<DemoLoadResult> | null = null;

// 装载过的演示包校验和记在本机（实施单元 09）。清单里的校验和变了，说明演示包有新版本，
// 本机上的是旧数据；旧项目不静默覆盖，由列表页提示后用户决定更新。
const LOADED_KEY = "gujian-demo-library-loaded";
function readLoaded(): Record<string, string> {
  try { return JSON.parse(globalThis.localStorage?.getItem(LOADED_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function rememberLoaded(demoId: string, sha: string): void {
  try { globalThis.localStorage?.setItem(LOADED_KEY, JSON.stringify({ ...readLoaded(), [demoId]: sha })); } catch { /* 无本机存储时不记 */ }
}

export interface DemoLibraryUpdate { readonly demoId: string; readonly projectName: string }

// 需要提示更新的演示项目：本机已装载但包有新版本的，加上装载残局（清单里的演示项目
// 只装进来一部分——首次装载在下载中途被关页打断就会这样，空库自动装载不会再跑，
// 不提示的话残局没有任何修复入口）。只有本机一个演示项目都没有时不提示，
// 免得对只用自己项目的用户推销清空重装。
export async function listDemoLibraryUpdates(input: { existingProjectIds: ReadonlySet<string>; baseUrl?: string }): Promise<DemoLibraryUpdate[]> {
  const manifest = await fetchManifest(input.baseUrl ?? "/").catch(() => null);
  if (!manifest) return [];
  const loaded = readLoaded();
  const demoPresent = manifest.projects.some((entry) => input.existingProjectIds.has(entry.projectId));
  return manifest.projects
    .filter((entry) => input.existingProjectIds.has(entry.projectId)
      ? loaded[entry.demoId] !== entry.packageSha256
      : demoPresent)
    .map((entry) => ({ demoId: entry.demoId, projectName: entry.projectName }));
}

// 已存在的项目不重复导入，也不覆盖：用户在演示项目上做过的操作要保留。
export function loadDemoLibrary(input: {
  packages: ProjectPackageService;
  existingProjectIds: ReadonlySet<string>;
  actorId: string;
  baseUrl?: string;
}): Promise<DemoLoadResult> {
  inFlight ??= runLoad(input).finally(() => { inFlight = null; });
  return inFlight;
}

async function runLoad(input: {
  packages: ProjectPackageService;
  existingProjectIds: ReadonlySet<string>;
  actorId: string;
  baseUrl?: string;
}): Promise<DemoLoadResult> {
  const base = input.baseUrl ?? "/";
  const manifest = await fetchManifest(base);
  if (!manifest) return { loaded: [], skipped: [], failed: [] };

  const loaded: string[] = [];
  const skipped: string[] = [];
  const failed: { demoId: string; reason: unknown }[] = [];
  for (const entry of manifest.projects) {
    if (input.existingProjectIds.has(entry.projectId)) {
      skipped.push(entry.demoId);
      continue;
    }
    try {
      const response = await fetch(`${base}demo/${entry.fileName}`);
      if (!response.ok) throw new Error("DEMO_PACKAGE_DOWNLOAD_FAILED");
      const bytes = new Uint8Array(await response.arrayBuffer());
      await input.packages.import(bytes, entry.fileName, input.actorId);
      rememberLoaded(entry.demoId, entry.packageSha256);
      loaded.push(entry.demoId);
    } catch (reason) {
      failed.push({ demoId: entry.demoId, reason });
    }
  }
  return { loaded, skipped, failed };
}
