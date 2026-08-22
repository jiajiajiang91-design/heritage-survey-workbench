import { useState } from "react";
import type { FormEvent } from "react";
import type { ProjectHead } from "@gujian/application";
import type { ArchetypeSpec } from "@gujian/domain";
import { compareWithMeasuredFacts, deriveArchetypeExpectations } from "@gujian/infrastructure";

import { DATA_STATUS_LABELS, LIFT_RATIO_SET_LABELS, REVIEW_LABELS, factFieldLabel, isFactFieldCode } from "../labels";
import { EvidencePane } from "../shell/EvidencePane";
import { Button, DataStatusTag, EmptyState, Field, InfoRow, SourceTag, Tag } from "../ui";
import { SplitPane } from "../ui/SplitPane";
import type { EvidencePane as EvidencePaneModel } from "../workbench/useEvidencePane";
import "./MeasurementBaseline.css";

// W03 实测基准（66:1720）：左卡尺寸表（表头 34、行 44，三列项目/数值/来源），右卡基准证据
// （图 210，基准线、尺寸单位、形制参数层三张事实卡）。基准是假设值还是实测由数据状态说明，不另造词。
type Snapshot = ProjectHead["snapshot"];
type Fact = Snapshot["facts"][number];
type Measurement = Snapshot["measurements"][number];

export interface MeasurementBaselineProps {
  snapshot: Snapshot;
  pane: EvidencePaneModel;
  archetypes: readonly ArchetypeSpec[];
  evidenceTitle: (ref: string) => string;
  onRegisterArchetype: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onConfirmDimensionChain: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

// 事实取值可能是数字、文字或带单位的对象，统一成一行文字
export function factValueText(value: unknown): string {
  if (value === null || value === undefined) return "未记录";
  if (typeof value === "number") return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as { value?: unknown; unit?: unknown; name?: unknown; methodZh?: unknown };
    if (record.value !== undefined) return `${String(record.value)}${record.unit ? ` ${String(record.unit)}` : ""}`;
    if (record.name !== undefined) return String(record.name);
    return JSON.stringify(value);
  }
  return String(value);
}

function factMethod(value: unknown): string | null {
  if (value && typeof value === "object" && "methodZh" in value) return String((value as { methodZh: unknown }).methodZh ?? "") || null;
  return null;
}

function ArchetypeForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return (
    <form className="sc-measure-form" onSubmit={(event) => void onSubmit(event)}>
      <span className="gj-pane-title">登记形制，用于核对实测</span>
      <p className="gj-pane-desc">填写开间、进深和举架做法后，系统按形制推算各处尺寸，供你与实测比对。实测记录始终优先，差异较大的项会提示记入现状。</p>
      <div className="sc-measure-form-grid">
        <Field label="逐间面阔 mm（逗号分隔）" required><input name="bayX" required placeholder="例如 4800" /></Field>
        <Field label="逐间进深 mm（逗号分隔）" required><input name="bayY" required placeholder="例如 1800,1800" /></Field>
        <Field label="步架数" required><input name="stepCount" type="number" min="1" max="20" required placeholder="七檩填 3" /></Field>
        <Field label="斗口或材宽 mm" required><input name="baseD" type="number" min="1" step="any" required placeholder="例如 380" /></Field>
        <Field label="举架做法">
          <select name="liftRatioSetRef" defaultValue="qing-gongcheng-zuofa">
            <option value="qing-gongcheng-zuofa">清工程做法举架系数</option>
            <option value="liang-drawings">梁思成图纸举架系数</option>
          </select>
        </Field>
        <Field label="柱位（列/行，逗号分隔）" required><input name="pillarNet" required placeholder="例如 0/0,0/1,1/0,1/1" /></Field>
        <Field label="枋连接的两根柱（可选）"><input name="fangNet" placeholder="例如 0/0#1/0,0/1#1/1" /></Field>
        <Field label="形制判断依据" required><input name="sourceDeclaration" required placeholder="例如 现场踏勘并对照同期实例" /></Field>
      </div>
      <div className="gj-actions"><Button variant="primary" type="submit">登记并推算尺寸</Button></div>
    </form>
  );
}

function DimensionChainForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return (
    <form className="sc-measure-form" onSubmit={(event) => void onSubmit(event)}>
      <span className="gj-pane-title">文档尺寸链核对</span>
      <p className="gj-pane-desc">只转写当前项目资料中的数值。系统自动计算差值；人工转写不等于现场测量。</p>
      <div className="sc-measure-form-grid">
        <Field label="总尺寸 mm" required><input name="totalWidthMm" type="number" min="1" step="any" required /></Field>
        <Field label="分段尺寸 mm" required><textarea name="segmentWidthsMm" required placeholder="例如：4200, 3600, 3600" /></Field>
      </div>
      <label className="gj-check"><input name="measurementMetadataComplete" type="checkbox" />资料已明确测量人、时间、方法和原始记录</label>
      <div className="gj-actions"><Button variant="primary" type="submit">转写并自动核对</Button></div>
    </form>
  );
}

export function MeasurementBaseline({ snapshot, pane, archetypes, evidenceTitle, onRegisterArchetype, onConfirmDimensionChain }: MeasurementBaselineProps) {
  const [form, setForm] = useState<"none" | "archetype" | "chain">("none");
  const archetype = archetypes.at(-1) ?? null;
  const derivation = archetype ? deriveArchetypeExpectations(archetype) : null;
  const comparisons = derivation ? compareWithMeasuredFacts(derivation, snapshot.facts) : [];
  const total = snapshot.measurements.length + snapshot.facts.length;
  const uncertain = snapshot.facts.filter((fact) => fact.dataStatus === "uncertain").length;
  const confirmed = snapshot.facts.filter((fact) => fact.reviewStatus === "confirmed").length;

  const submitArchetype = async (event: FormEvent<HTMLFormElement>) => { await onRegisterArchetype(event); setForm("none"); };
  const submitChain = async (event: FormEvent<HTMLFormElement>) => { await onConfirmDimensionChain(event); setForm("none"); };

  // 点一行，右卡切到这条事实引用的第一份能显示的资料（v4 右卡没有切换下拉）
  const showEvidenceOf = (refs: readonly string[]) => {
    const target = refs.map((ref) => snapshot.evidences.find((item) => item.id === ref)).find((item) => item && item.dataStatus === "available") ?? snapshot.evidences.find((item) => refs.includes(item.id));
    if (target) pane.setActiveEvidenceId(target.id);
  };
  const rowOfFact = (fact: Fact) => (
    <div className="sc-measure-row" key={fact.id} title={factMethod(fact.value) ?? undefined} role="button" tabIndex={0}
      aria-current={fact.evidenceRefs.includes(pane.activeEvidenceId ?? "") ? "true" : undefined}
      onClick={() => showEvidenceOf(fact.evidenceRefs)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showEvidenceOf(fact.evidenceRefs); } }}>
      <span className={`sc-measure-name${isFactFieldCode(fact.field) ? " gj-numeric" : ""}`}>{factFieldLabel(fact.field)}</span>
      <span className="sc-measure-value">{factValueText(fact.value)}</span>
      {/* 来源列按 v4（66:1720）一行一个标签：来源标记；存疑或缺失时换成数据状态，已确认时加一枚确认标签 */}
      <span className="sc-measure-tags">
        {fact.dataStatus !== "available"
          ? <DataStatusTag status={fact.dataStatus} label={DATA_STATUS_LABELS[fact.dataStatus] ?? fact.dataStatus} />
          : <SourceTag producerType={fact.producer.producerType} />}
        {fact.reviewStatus === "confirmed" && <Tag tone="success">{REVIEW_LABELS.confirmed}</Tag>}
      </span>
    </div>
  );
  const rowOfMeasurement = (measurement: Measurement) => (
    <div className="sc-measure-row" key={measurement.id} title={evidenceTitle(measurement.originalEvidenceRef)} role="button" tabIndex={0}
      onClick={() => showEvidenceOf([measurement.originalEvidenceRef])} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showEvidenceOf([measurement.originalEvidenceRef]); } }}>
      <span className="sc-measure-name">{measurement.subjectRef}</span>
      <span className="sc-measure-value">{measurement.quantity.originalText} {measurement.quantity.originalUnit}</span>
      <span className="sc-measure-tags">
        <SourceTag producerType={measurement.producer.producerType} />
        <Tag tone={measurement.metadataStatus === "complete" ? "success" : "warning"}>{measurement.metadataStatus === "complete" ? "记录完整" : "缺测量人、时间或方法"}</Tag>
      </span>
    </div>
  );

  return (
    <SplitPane
      data={(
        <>
          <span className="gj-pane-title">尺寸与基准 · {total} 条记录</span>
          <p className="gj-pane-desc">
            {total
              ? `${snapshot.facts.length} 条事实里 ${confirmed} 条已确认、${uncertain} 条存疑${snapshot.measurements.length ? `，另有 ${snapshot.measurements.length} 条测量记录` : "，没有现场测量记录"}。`
              : "还没有可用的尺寸。尺寸缺失时，依赖它的成果不会生成，系统也不会用默认值补齐。"}
          </p>
          {total > 0 && (
            <div className="sc-measure-table">
              <div className="sc-measure-head"><span>项目</span><span>数值</span><span>来源</span></div>
              {snapshot.measurements.map(rowOfMeasurement)}
              {snapshot.facts.map(rowOfFact)}
            </div>
          )}
          {derivation && comparisons.length > 0 && (
            <div className="sc-measure-compare">
              <span className="gj-pane-title">按形制推算的尺寸与实测对照</span>
              <p className="gj-pane-desc">采用{LIFT_RATIO_SET_LABELS[derivation.ruleSetId] ?? derivation.ruleSetId}，柱位 {derivation.layout.pillarCount} 处，枋连接 {derivation.layout.fangCount} 处。推算值只作核对参考，实测记录始终优先。</p>
              {comparisons.map((item) => (
                <InfoRow
                  key={item.dimension}
                  label={`${item.dimension} · 推算 ${item.valueMm !== null ? `${item.valueMm} mm` : "按实际测量"}${item.toleranceText ? `，允许偏差 ${item.toleranceText}` : ""}`}
                  value={item.measuredMm !== null ? `实测 ${item.measuredMm} mm${item.deltaMm !== null ? `，相差 ${item.deltaMm} mm` : ""}` : "尚无实测记录"}
                  trailing={item.withinTolerance === null ? <Tag>缺实测</Tag> : item.withinTolerance ? <Tag tone="success">在允许偏差内</Tag> : <Tag tone="warning">超出允许偏差</Tag>}
                />
              ))}
            </div>
          )}
          {form === "archetype" && <ArchetypeForm onSubmit={submitArchetype} />}
          {form === "chain" && (snapshot.evidences.length ? <DimensionChainForm onSubmit={submitChain} /> : <EmptyState>先上传资料，尺寸链只能从本项目资料转写。</EmptyState>)}
          <span className="gj-spacer" />
          <div className="gj-actions">
            {form !== "none" && <Button onClick={() => setForm("none")}>收起</Button>}
            {!archetype && <Button onClick={() => setForm(form === "archetype" ? "none" : "archetype")}>登记形制</Button>}
            <Button variant="primary" onClick={() => setForm(form === "chain" ? "none" : "chain")}>转写尺寸链</Button>
          </div>
        </>
      )}
      aside={(
        <EvidencePane
          evidences={snapshot.evidences}
          pane={pane}
          title="基准证据"
          emptyHint="选择资料查看手写草图或测量记录原件。"
          detail={(
            <div className="gj-pane-list">
              <div className="gj-card gj-card--compact">
                <InfoRow
                  label="基准线"
                  value={archetype ? `斗口或材宽 ${archetype.baseParams.D} mm（${archetype.sourceDeclaration}）` : snapshot.measurements.length ? "以现场测量记录为基准" : "未登记形制，也没有现场测量记录"}
                  trailing={archetype ? <Tag tone="warning">形制假设值</Tag> : snapshot.measurements.length ? <Tag tone="success">实测</Tag> : <Tag tone="danger">缺失</Tag>}
                />
              </div>
              <div className="gj-card gj-card--compact">
                <InfoRow label="尺寸单位" value="毫米，全项目固定" trailing={<Tag>非任务字段</Tag>} />
              </div>
              <div className="gj-card gj-card--compact">
                <InfoRow
                  label="形制参数层"
                  value={archetype ? (archetype.liftRatioSetRef ? LIFT_RATIO_SET_LABELS[archetype.liftRatioSetRef] ?? archetype.liftRatioSetRef : "未指定举架做法") : "未登记形制"}
                  trailing={archetype ? <SourceTag producerType="rule" /> : undefined}
                />
              </div>
            </div>
          )}
        />
      )}
    />
  );
}
