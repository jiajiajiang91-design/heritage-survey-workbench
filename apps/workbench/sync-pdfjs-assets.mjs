// 把 pdf.js 的 worker、wasm 解码器、标准字体与字符映射复制到 public/pdfjs，
// 页内 PDF 查看器从同源加载，不依赖外网（实施单元 09）。dev 与 build 前各跑一次。
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "node_modules/pdfjs-dist");
const target = resolve(here, "public/pdfjs");

function copyTree(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) copyTree(join(from, name), join(to, name));
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

for (const [from, to] of [["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"], ["wasm", "wasm"], ["standard_fonts", "standard_fonts"], ["cmaps", "cmaps"]]) {
  const path = resolve(source, from);
  if (!existsSync(path)) { console.warn(`pdfjs 资源缺失：${from}`); continue; }
  copyTree(path, resolve(target, to));
}
console.log("pdfjs 资源已同步到 public/pdfjs");
