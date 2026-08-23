import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DxfParser, { type IDxf, type IEntity } from "dxf-parser";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { GlbViewer } from "../GlbViewer";
import { Button } from "./index";
import "./FileViewer.css";

// 统一文件查看器（实施单元 09）：图片、SVG、PDF、DXF、GLB 都在页内看，不让用户下载后自己开。
// PDF 用 pdf.js 本地渲染（不用浏览器内置阅读器的工具条）；DXF 解析后渲染成 SVG 线图；
// DWG 是闭源格式，页内看不了，给下载与说明。缩放与平移由查看器自己管。

// pdf.js 按需加载：它在模块顶层就要用 DOMMatrix，测试环境（jsdom）没有；也让主包不带它
// worker、wasm 解码器（JBIG2、JPX）、标准字体与字符映射由 sync-pdfjs-assets.mjs 复制到 public/pdfjs，同源加载
const PDFJS_ASSETS = "/pdfjs/";
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}pdf.worker.min.mjs`;
  return pdfjs;
}

export type ViewerKind = "image" | "svg" | "pdf" | "dxf" | "glb" | "unsupported";

export function viewerKindOf(mimeType: string, fileName: string): ViewerKind {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  // DXF 的 MIME 常写成 image/vnd.dxf，要先于图片判断
  if (extension === "dxf" || mimeType === "image/vnd.dxf" || mimeType === "application/dxf") return "dxf";
  if (mimeType === "image/svg+xml" || extension === "svg") return "svg";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (extension === "glb" || mimeType === "model/gltf-binary") return "glb";
  return "unsupported";
}

export interface FileViewerProps {
  // 文件本体，或已建好的对象地址（预览地址由调用方管理生命周期）
  blob: Blob | string;
  mimeType: string;
  fileName: string;
  // 图片类由调用方自己渲染（资料原件要带框选），这里只接其余类型；给了就用它
  imageSlot?: ReactNode;
  onDownload?: () => void;
  // 高度由调用方按版面给，查看器在其中缩放平移
  height?: number | string;
}

export function FileViewer({ blob: source, mimeType, fileName, imageSlot, onDownload, height }: FileViewerProps) {
  const kind = viewerKindOf(mimeType, fileName);
  const style = height !== undefined ? { height } : undefined;
  const blob = useResolvedBlob(source, mimeType);
  if (kind !== "image" && kind !== "svg" && !blob) return <div className="gj-viewer gj-viewer--empty" style={style}><span className="gj-viewer-loading">正在读取文件</span></div>;
  if (kind === "image" && imageSlot) return <div className="gj-viewer" style={style}>{imageSlot}</div>;
  if (kind === "image" || kind === "svg") return <ZoomPane style={style}><SourceImage source={source} alt={fileName} /></ZoomPane>;
  if (!blob) return null;
  if (kind === "pdf") return <PdfPane blob={blob} style={style} />;
  if (kind === "dxf") return <DxfPane blob={blob} style={style} />;
  if (kind === "glb") return <div className="gj-viewer" style={style}><GlbViewer blob={blob} onSelect={() => { /* 独立查看不联动选中 */ }} /></div>;
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return (
    <div className="gj-viewer gj-viewer--empty" style={style}>
      <span>{extension === "dwg" ? "DWG 是闭源格式，页内看不了；同一套图纸有 DXF 可在页内查看，DWG 请下载后用 CAD 软件打开。" : "该类型的文件无法在页内显示。"}</span>
      {onDownload && <Button variant="text" onClick={onDownload}>下载原文件</Button>}
    </div>
  );
}

// 地址形式的来源先取回文件本体；文件本体直接用
function useResolvedBlob(source: Blob | string, mimeType: string): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(typeof source === "string" ? null : source);
  useEffect(() => {
    if (typeof source !== "string") { setBlob(source); return; }
    let cancelled = false;
    setBlob(null);
    fetch(source).then((response) => response.blob()).then((fetched) => { if (!cancelled) setBlob(fetched.type ? fetched : new Blob([fetched], { type: mimeType })); }).catch(() => { if (!cancelled) setBlob(null); });
    return () => { cancelled = true; };
  }, [source, mimeType]);
  return blob;
}

// ---------- 图片 ----------
function SourceImage({ source, alt }: { source: Blob | string; alt: string }) {
  const [url, setUrl] = useState<string | null>(typeof source === "string" ? source : null);
  useEffect(() => {
    if (typeof source === "string") { setUrl(source); return; }
    const created = URL.createObjectURL(source);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [source]);
  return url ? <img src={url} alt={alt} draggable={false} /> : null;
}

// ---------- 缩放平移容器：滚轮缩放、拖动平移、双击复位 ----------
function ZoomPane({ children, style, toolbar }: { children: ReactNode; style?: React.CSSProperties | undefined; toolbar?: ReactNode | undefined }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  return (
    <div className="gj-viewer" style={style}>
      <div className="gj-viewer-tools">
        <Button icon compact onClick={() => setScale((value) => Math.max(0.2, value / 1.25))} aria-label="缩小">−</Button>
        <span className="gj-viewer-scale">{Math.round(scale * 100)}%</span>
        <Button icon compact onClick={() => setScale((value) => Math.min(16, value * 1.25))} aria-label="放大">+</Button>
        <Button compact onClick={reset}>适应</Button>
        {toolbar}
      </div>
      <div
        className="gj-viewer-stage"
        onWheel={(event) => { event.preventDefault(); setScale((value) => Math.min(16, Math.max(0.2, value * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))); }}
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={reset}
      >
        <div className="gj-viewer-content" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>{children}</div>
      </div>
    </div>
  );
}

// ---------- PDF：逐页渲染到画布 ----------
function PdfPane({ blob, style }: { blob: Blob; style?: React.CSSProperties | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDocument(null); setPage(1); setError(null);
    Promise.all([loadPdfJs(), blob.arrayBuffer()]).then(([pdfjs, buffer]) => pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // 扫描件的 JBIG2、JPX 图像靠 wasm 解码器，路径指到同源资源，否则整页空白
      wasmUrl: `${PDFJS_ASSETS}wasm/`,
      standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
      cMapUrl: `${PDFJS_ASSETS}cmaps/`,
      cMapPacked: true,
    }).promise)
      .then((loaded) => { if (!cancelled) setDocument(loaded); else void (loaded as unknown as { destroy?: () => Promise<void> }).destroy?.(); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "PDF 无法读取"); });
    return () => { cancelled = true; };
  }, [blob]);
  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    // 渲染任务要能取消：开发模式下 effect 会连跑两次，前一次不取消就会和后一次抢同一块画布，
    // 后一次改画布尺寸又会把前一次画好的清掉
    let task: { cancel: () => void } | null = null;
    const canvas = canvasRef.current;
    document.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      // 按 2 倍像素渲染，放大后仍清楚
      const viewport = pdfPage.getViewport({ scale: 2 });
      canvas.width = viewport.width; canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / 2}px`; canvas.style.height = `${viewport.height / 2}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      task = pdfPage.render({ canvasContext: context, viewport, canvas });
      return (task as unknown as { promise: Promise<void> }).promise.then(() => { if (!cancelled) canvas.dataset.rendered = String(page); });
    }).catch((reason: unknown) => {
      // 页面切换中途取消是正常的；其余原因记到控制台，不弹给用户
      if (!cancelled) console.warn("PDF 渲染失败", reason);
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [document, page]);
  if (error) return <div className="gj-viewer gj-viewer--empty" style={style}><span>PDF 无法读取：{error}</span></div>;
  const pages = document?.numPages ?? 0;
  return (
    <ZoomPane style={style} toolbar={pages > 1 ? (
      <span className="gj-viewer-pages">
        <Button icon compact disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="上一页">‹</Button>
        <span className="gj-viewer-scale">{page} / {pages}</span>
        <Button icon compact disabled={page >= pages} onClick={() => setPage((value) => value + 1)} aria-label="下一页">›</Button>
      </span>
    ) : undefined}>
      {document ? <canvas ref={canvasRef} className="gj-viewer-canvas" /> : <span className="gj-viewer-loading">正在读取 PDF</span>}
    </ZoomPane>
  );
}

// ---------- DXF：解析后画成 SVG 线图 ----------
interface DxfBounds { minX: number; minY: number; maxX: number; maxY: number }

const DXF_ENTITY_TYPES = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "TEXT", "MTEXT", "INSERT", "DIMENSION", "ELLIPSE", "SPLINE", "SOLID"]);

type AnyEntity = IEntity & Record<string, unknown>;

function point(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function extend(bounds: DxfBounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y);
}

// 把一组实体画成 SVG 片段；块引用递归画块内实体，位置、缩放与旋转由 transform 带
function renderEntities(entities: readonly AnyEntity[], dxf: IDxf, bounds: DxfBounds, depth: number): string[] {
  if (depth > 6) return [];
  const parts: string[] = [];
  const esc = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] ?? ch));
  for (const entity of entities) {
    const type = String(entity.type ?? "");
    if (!DXF_ENTITY_TYPES.has(type)) continue;
    if (type === "LINE") {
      const [a, b] = ((entity.vertices as unknown[]) ?? []).map(point);
      if (!a || !b) continue;
      extend(bounds, a.x, a.y); extend(bounds, b.x, b.y);
      parts.push(`<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" />`);
    } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const vertices = ((entity.vertices as unknown[]) ?? []).map(point).filter((item): item is { x: number; y: number } => item !== null);
      if (vertices.length < 2) continue;
      vertices.forEach((item) => extend(bounds, item.x, item.y));
      const closed = Boolean(entity.shape);
      parts.push(`<${closed ? "polygon" : "polyline"} points="${vertices.map((item) => `${item.x},${-item.y}`).join(" ")}" />`);
    } else if (type === "CIRCLE") {
      const center = point(entity.center); const radius = Number(entity.radius);
      if (!center || !Number.isFinite(radius)) continue;
      extend(bounds, center.x - radius, center.y - radius); extend(bounds, center.x + radius, center.y + radius);
      parts.push(`<circle cx="${center.x}" cy="${-center.y}" r="${radius}" />`);
    } else if (type === "ARC") {
      const center = point(entity.center); const radius = Number(entity.radius);
      const start = Number(entity.startAngle); const end = Number(entity.endAngle);
      if (!center || !Number.isFinite(radius) || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      const sweep = ((end - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const sx = center.x + radius * Math.cos(start); const sy = center.y + radius * Math.sin(start);
      const ex = center.x + radius * Math.cos(end); const ey = center.y + radius * Math.sin(end);
      extend(bounds, center.x - radius, center.y - radius); extend(bounds, center.x + radius, center.y + radius);
      // DXF 角度逆时针为正；SVG 的 y 轴向下，翻转后扫掠方向反过来
      parts.push(`<path d="M ${sx} ${-sy} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 0 ${ex} ${-ey}" />`);
    } else if (type === "TEXT" || type === "MTEXT") {
      const position = point(type === "TEXT" ? entity.startPoint : entity.position);
      const size = Number(type === "TEXT" ? entity.textHeight : entity.height) || 2.5;
      const text = String(entity.text ?? "").replace(/\\P/g, " ").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "");
      if (!position || !text) continue;
      extend(bounds, position.x, position.y); extend(bounds, position.x + text.length * size * 0.8, position.y + size);
      const rotation = Number(entity.rotation) || 0;
      parts.push(`<text x="${position.x}" y="${-position.y}" font-size="${size}" transform="rotate(${-rotation} ${position.x} ${-position.y})">${esc(text)}</text>`);
    } else if (type === "INSERT" || type === "DIMENSION") {
      const name = String(type === "INSERT" ? entity.name : entity.block ?? "");
      const block = name ? dxf.blocks?.[name] : undefined;
      if (!block?.entities?.length) continue;
      const position = point(type === "INSERT" ? entity.position : entity.anchorPoint) ?? { x: 0, y: 0 };
      const base = point(block.position) ?? { x: 0, y: 0 };
      const xScale = Number(entity.xScale) || 1; const yScale = Number(entity.yScale) || 1;
      const rotation = Number(entity.rotation) || 0;
      const inner: DxfBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      const innerParts = renderEntities(block.entities as AnyEntity[], dxf, inner, depth + 1);
      if (!innerParts.length) continue;
      if (type === "INSERT") {
        // 块内坐标按插入点、缩放、旋转变换到图面；包围盒按变换后的四角扩
        const corners = [[inner.minX, inner.minY], [inner.maxX, inner.minY], [inner.minX, inner.maxY], [inner.maxX, inner.maxY]];
        const rad = (rotation * Math.PI) / 180;
        for (const [cx = Number.NaN, cy = Number.NaN] of corners) {
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
          const lx = (cx - base.x) * xScale; const ly = (cy - base.y) * yScale;
          extend(bounds, position.x + lx * Math.cos(rad) - ly * Math.sin(rad), position.y + lx * Math.sin(rad) + ly * Math.cos(rad));
        }
        parts.push(`<g transform="translate(${position.x} ${-position.y}) rotate(${-rotation}) scale(${xScale} ${yScale}) translate(${-base.x} ${base.y})">${innerParts.join("")}</g>`);
      } else {
        // 标注块（*D 块）已经在图面坐标里
        if (Number.isFinite(inner.minX)) { extend(bounds, inner.minX, inner.minY); extend(bounds, inner.maxX, inner.maxY); }
        parts.push(`<g>${innerParts.join("")}</g>`);
      }
    } else if (type === "SOLID") {
      const vertices = ((entity.points as unknown[]) ?? []).map(point).filter((item): item is { x: number; y: number } => item !== null);
      if (vertices.length < 3) continue;
      vertices.forEach((item) => extend(bounds, item.x, item.y));
      parts.push(`<polygon points="${vertices.map((item) => `${item.x},${-item.y}`).join(" ")}" class="gj-dxf-solid" />`);
    } else if (type === "ELLIPSE" || type === "SPLINE") {
      const vertices = ((entity.controlPoints ?? entity.fitPoints) as unknown[] | undefined)?.map(point).filter((item): item is { x: number; y: number } => item !== null) ?? [];
      if (vertices.length >= 2) {
        vertices.forEach((item) => extend(bounds, item.x, item.y));
        parts.push(`<polyline points="${vertices.map((item) => `${item.x},${-item.y}`).join(" ")}" />`);
      }
    }
  }
  return parts;
}

function dxfToSvg(text: string): { svg: string; entityCount: number } {
  const dxf = new DxfParser().parseSync(text);
  if (!dxf) throw new Error("DXF 解析失败");
  const bounds: DxfBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const entities = (dxf.entities ?? []) as AnyEntity[];
  const parts = renderEntities(entities, dxf, bounds, 0);
  if (!parts.length || !Number.isFinite(bounds.minX)) throw new Error("DXF 里没有可画的实体");
  const width = Math.max(1, bounds.maxX - bounds.minX); const height = Math.max(1, bounds.maxY - bounds.minY);
  const margin = Math.max(width, height) * 0.03;
  // 线宽按图面尺寸定，缩放时保持可见（vector-effect）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX - margin} ${-bounds.maxY - margin} ${width + margin * 2} ${height + margin * 2}" `
    + `fill="none" stroke="currentColor" stroke-width="${Math.max(width, height) / 900}" stroke-linecap="round" stroke-linejoin="round" font-family="sans-serif">`
    + `<style>text{fill:currentColor;stroke:none}.gj-dxf-solid{fill:currentColor;stroke:none;opacity:.15}</style>${parts.join("")}</svg>`;
  return { svg, entityCount: parts.length };
}

function DxfPane({ blob, style }: { blob: Blob; style?: React.CSSProperties | undefined }) {
  const [state, setState] = useState<{ svg: string; count: number } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setState(null);
    blob.text().then((text) => {
      if (cancelled) return;
      try {
        const { svg, entityCount } = dxfToSvg(text);
        setState({ svg, count: entityCount });
      } catch (reason) {
        setState({ error: reason instanceof Error ? reason.message : "DXF 无法读取" });
      }
    }).catch(() => { if (!cancelled) setState({ error: "DXF 无法读取" }); });
    return () => { cancelled = true; };
  }, [blob]);
  const markup = useMemo(() => (state && "svg" in state ? { __html: state.svg } : null), [state]);
  if (state && "error" in state) return <div className="gj-viewer gj-viewer--empty" style={style}><span>DXF 无法在页内显示：{state.error}</span></div>;
  return (
    <ZoomPane style={style} toolbar={state && "count" in state ? <span className="gj-viewer-scale">{state.count} 个图元</span> : undefined}>
      {markup ? <div className="gj-viewer-dxf" dangerouslySetInnerHTML={markup} /> : <span className="gj-viewer-loading">正在读取 DXF</span>}
    </ZoomPane>
  );
}
