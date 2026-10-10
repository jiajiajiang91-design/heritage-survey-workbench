import { useState } from "react";
import type { ProjectHead } from "@gujian/application";

import { DRAWING_KIND_LABELS } from "../labels";
import { UNIT_LABELS } from "../production-task";
import { Button, EmptyState, Tag } from "../ui";
import type { TaskSetupValues, ReferenceOption, RequirementReferences } from "../task-requirements";
import { overlapsTitleBlock, outsidePrintableArea } from "../task-requirements";
import { TaskSetupForm } from "./TaskSetupForm";
import { FileViewer } from "../ui/FileViewer";
import { describePreview, pageLabel, previewLabel, type DrawingPreview } from "../workbench/useAssetUrls";
import "./SheetStyle.css";

// W08 图纸样式（66:2896）：左卡出图设置（六行标签 132 宽加取值，下边线），右卡图面预览（头 36、图 476、说明 12/20）。
// 出图要求与任务卡共用同一表单和写入入口。
type TaskDefinition = ProjectHead["snapshot"]["taskDefinitions"][number];

export interface SheetStyleProps {
  task: TaskDefinition | null;
  references: RequirementReferences;
  roleOptions: ReferenceOption[];
  onSubmitTask: (values: TaskSetupValues) => Promise<boolean>;
  previews: readonly DrawingPreview[];
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
  onEditTask: () => void;
}


export function SheetStyle({ task, references, roleOptions, onSubmitTask, previews, canGenerate, generating, onGenerate, onEditTask }: SheetStyleProps) {
  const [editing, setEditing] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const requirements = task?.artifactRequirements ?? null;
  const views = requirements?.views ?? [];
  const sheets = requirements?.sheets ?? [];
  const overlapping = views.filter((view) => {
    const sheet = sheets.find((item) => item.key === view.sheetKey);
    return sheet && overlapsTitleBlock(view.viewportRectMm, sheet.pageMm[0]);
  });
  const outside = views.filter((view) => {
    const sheet = sheets.find((item) => item.key === view.sheetKey);
    return sheet && outsidePrintableArea(view.viewportRectMm, sheet.pageMm);
  });
  const preview = previews[Math.min(previewIndex, Math.max(0, previews.length - 1))] ?? null;
  const kinds = [...new Set(views.map((view) => DRAWING_KIND_LABELS[view.kind] ?? view.kind))];
  const scaleByKind = kinds.map((kind) => {
    const scales = [...new Set(views.filter((view) => (DRAWING_KIND_LABELS[view.kind] ?? view.kind) === kind).map((view) => `1:${view.scaleDenominator}`))];
    return `${kind} ${scales.join("、")}`;
  });
  // 预览属于已生成文件，不能使用刚修改的任务比例给旧图面标注。
  const { title: previewTitle, scales: previewScales } = describePreview(preview, null);

  const rows: [string, string][] = requirements ? [
    ["成果图种", views.map((view) => view.displayLabelZh).join("、")],
    ["出图比例", scaleByKind.join("，")],
    ["图幅", sheets.map((sheet) => `${sheet.drawingNumber} 为 ${pageLabel(sheet.pageMm)}`).join("，")],
    ["长度输出单位", UNIT_LABELS[task?.productionSetup?.outputUnit ?? "mm"]],
    ["标注体系（固定设置）", "轴网、尺寸链、标高、剖切索引、构件引线，出图时统一生成"],
    ["版本", requirements.revisionLabel],
  ] : [];

  return (
    <div className={editing ? "sc-sheet sc-sheet--editing" : "sc-sheet"}>
      <section className="sc-sheet-settings sc-sheet-settings--hug">
        <span className="gj-pane-title">出图设置</span>
        {editing && task ? <TaskSetupForm task={task} requirementsOnly references={references} roleOptions={roleOptions} onCancel={() => setEditing(false)} onSubmit={async (values) => {
          const ok = await onSubmitTask(values); if (ok) setEditing(false); return ok;
        }} /> : requirements ? rows.map(([label, value]) => (
          <div className="sc-sheet-row" key={label}>
            <span className="sc-sheet-label">{label}</span>
            <span className="sc-sheet-value">{value || "未填写"}</span>
          </div>
        )) : (
          <EmptyState action={<Button compact onClick={() => task ? setEditing(true) : onEditTask()}>{task ? "设置出图要求" : "确认制作任务"}</Button>}>尚未设置出图要求。请在这里填写图幅、视图和图签。</EmptyState>
        )}
        <span className="gj-spacer" />
        {!editing && overlapping.length > 0 && <p role="alert" className="gj-note">{overlapping.map((view) => view.displayLabelZh).join("、")}的视口与右下图签重叠。请修改出图要求，将视口 Y 调整为至少 38 mm，或移至图签左侧。</p>}
        {!editing && outside.length > 0 && <p role="alert" className="gj-note">{outside.map((view) => view.displayLabelZh).join("、")}的视口超出可打印区域。请修改出图要求，留出左右各 10 mm、下侧 20 mm、上侧 35 mm；移动视口后需相应缩小宽高。</p>}
        {!editing && <div className="gj-actions">
          <Button onClick={() => task ? setEditing(true) : onEditTask()}>修改出图要求</Button>
          <Button variant="primary" loadable busy={generating} disabled={!canGenerate || overlapping.length > 0 || outside.length > 0} onClick={onGenerate}>生成成组图纸</Button>
        </div>}
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
            : <FileViewer blob={preview.url} mimeType="application/pdf" fileName={preview.label} height={476} />
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
        {preview && <p className="sc-sheet-note">此处显示已生成的文件，修改设置后重新生成才会更新。</p>}
      </section>
    </div>
  );
}
