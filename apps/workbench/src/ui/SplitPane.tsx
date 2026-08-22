import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

// 数据与证据双半区（05 表 2、07 第 6.4 节）：左数据、右证据，中间分隔条可拖，
// 比例限制在 30% 至 70%。只管布局与拖动，半区内容由调用方给。
const MIN_RATIO = 30;
const MAX_RATIO = 70;
const clamp = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

export function SplitPane({ data, aside, asideLabel = "证据区", initialRatio = 50 }: { data: ReactNode; aside: ReactNode; asideLabel?: string; initialRatio?: number }) {
  const [ratio, setRatio] = useState(clamp(initialRatio));
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const move = (pointer: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      setRatio(clamp(((pointer.clientX - bounds.left) / bounds.width) * 100));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  // 键盘可达：方向键以 5% 步进调整（07 第 7 节）
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setRatio((current) => clamp(current + (event.key === "ArrowRight" ? 5 : -5)));
  };

  return (
    <div className="gj-split" ref={containerRef} style={{ "--split-ratio": `${ratio}%` } as React.CSSProperties}>
      <div className="gj-split-data">{data}</div>
      <div
        className="gj-split-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整数据区与证据区的宽度"
        aria-valuenow={Math.round(ratio)}
        aria-valuemin={MIN_RATIO}
        aria-valuemax={MAX_RATIO}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={nudge}
      />
      <aside className="gj-split-aside" aria-label={asideLabel}>{aside}</aside>
    </div>
  );
}
