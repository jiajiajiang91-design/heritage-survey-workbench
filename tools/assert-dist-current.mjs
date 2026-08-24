// 演示包从 dist 构建。dist 落后于源码时，构建会静默产出按旧代码算出来的包，
// 数据看着正常但内容是错的：2026-08-22 就因为 dist 没跟上，三个演示包少带了
// 命令回执，而构建本身退出码为 0，事后靠解包比对才发现。
//
// 这个模块在构建脚本里第一个导入，先于任何 dist 导入求值。它不去猜 dist 新不新，
// 直接把增量构建跑一遍：tsc -b 按内容判断，没改动时几秒返回，改过就补上。
// 只做检查会有反向问题：改回原内容或 git 检出重写时间戳都会让时间戳比较永久误报。

import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

try {
  // 定长命令，无动态参数，用 execSync 走 shell 以兼容 Windows 上的 corepack.cmd
  execSync("corepack pnpm exec tsc -b", {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
} catch (error) {
  const detail = [error.stdout, error.stderr]
    .map((part) => (part ? String(part).trim() : ""))
    .filter(Boolean)
    .join("\n");
  console.error("构建 dist 失败，演示包没有开始生成：");
  if (detail) console.error(detail);
  process.exit(1);
}
