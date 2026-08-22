import { useState } from "react";
import type { ProjectHead } from "@gujian/application";

import { DRAWING_KIND_LABELS } from "../labels";
import { Button, EmptyState, Tag } from "../ui";
import { describePreview, pageLabel, previewLabel, type DrawingPreview } from "../workbench/useAssetUrls";
import "./SheetStyle.css";

// W08 图纸样式（66:2896）：左卡出图设置（六行标签 132 宽加取值，下边线），右卡图面预览（头 36、图 476、说明 12/20）。
// 图种、图幅和版面来自任务要求（PRD F12、F13），这里只读显示，修改回任务卡。
type TaskDefinition = ProjectHead["snapshot"]["taskDefinitions"][number];

export interface SheetStyleProps {
  task: TaskDefinition | null;
  previews: readonly DrawingPreview[];
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
  onEditTask: () => void;
}


export function SheetStyle({ task, previews, canGenerate, generating, onGenerate, onEditTask }: SheetStyleProps) {
  const [previewIndex, setPreviewIndex] = useState(0);
  const requirements = task?.artifactRequirements ?? null;
  const views = requirements?.views ?? [];
  const sheets = requirements?.sheets ?? [];
  const preview = previews[Math.min(previewIndex, Math.max(0, previews.length - 1))] ?? null;
  const kinds = [...new Set(views.map((view) => DRAWING_KIND_LABELS[view.kind] ?? view.kind))];
  const scaleByKind = kinds.map((kind) => {
    const scales = [...new Set(views.filter((view) => (DRAWING_KIND_LABELS[view.kind] ?? view.kind) === kind).map((view) => `1:${view.scaleDenominator}`))];
    return `${kind} ${scales.join("、")}`;
  });
  const { title: previewTitle, scales: previewScales } = describePreview(preview, requirements);

  const rows: [string, string][] = requirements ? [
    ["成果图种", views.map((view) => view.displayLabelZh).join("、")],
    ["出图比例", scaleByKind.join("，")],
    ["图幅", sheets.map((sheet) => `${sheet.drawingNumber} 为 ${pageLabel(sheet.pageMm)}`).join("，")],
    ["尺寸单位（非任务字段）", "毫米，全项目固定"],
    ["标注体系（非任务字段）", "轴网、尺寸链、标高、剖切索引、构件引线，出图时统一生成"],
    ["版本", requirements.revisionLabel],
  ] : [];

  return (
    <div className="sc-sheet">
      <section className="sc-sheet-settings sc-sheet-settings--hug">
        <span className="gj-pane-title">出图设置</span>
        {requirements ? rows.map(([label, value]) => (
          <div className="sc-sheet-row" key={label}>
            <span className="sc-sheet-label">{label}</span>
            <span className="sc-sheet-value">{value || "未填写"}</span>
          </div>
        )) : (
          <EmptyState action={<Button compact onClick={onEditTask}>去任务卡确认</Button>}>尚未确认成果要求。图幅、视图与图签在任务要求中一次确认后显示在这里。</EmptyState>
        )}
        <span className="gj-spacer" />
        <div className="gj-actions">
          <Button onClick={onEditTask}>在任务要求中修改</Button>
          <Button variant="primary" loadable busy={generating} disabled={!canGenerate} onClick={onGenerate}>生成成组图纸</Button>
        </div>
      </section>
      <section className="sc-sheet-preview">
        <div className="sc-sheet-preview-head">
          <span className="gj-pane-title" title={previewTitle}>{previewTitle}</span>
          <span className="gj-spacer" />
          {previewScales.length > 0 && <Tag tone="accent">{previewScales.join("、")}</Tag>}
        </div>
        {preview ? (
          preview.kind === "svg"
            ? <div className="sc-sheet-figure"><img src={preview.url} alt={`${preview.label} 图面预览`} /></div>
            : <object className="sc-sheet-figure" data={preview.url} type="application/pdf" aria-label={`${preview.label} 图面预览`} />
        ) : (
          <div className="sc-sheet-figure sc-sheet-figure--empty">生成成组图纸后，这里显示应用当前版面的实际图面。</div>
        )}
        {previews.length > 1 && (
          <div className="sc-sheet-switch" role="tablist" aria-label="切换预览图">
            {previews.map((item, index) => (
              <button key={item.id} type="button" role="tab" aria-current={index === previewIndex ? "true" : undefined} onClick={() => setPreviewIndex(index)}>{previewLabel(item)}</button>
            ))}
          </div>
        )}
        <p className="sc-sheet-note">平面图为水平剖切，剖面图剖在任务要求指定的剖切位置上，都不是俯视投影；构件画法与标注规则按制图配置统一生成，暂不在此逐项选择。</p>
      </section>
    </div>
  );
}
