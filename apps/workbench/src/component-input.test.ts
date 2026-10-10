import { describe, expect, it } from "vitest";
import { buildComponentInput, componentDraft, componentInputs, type ComponentInput } from "./component-input";
import { componentFixture } from "./test/component-fixture";
import { FactEnvelopeSchema } from "@gujian/domain";

describe("构件参数转换", () => {
  it("空白长度、坐标和来源逐项报错，不补默认值", async () => {
    const { head } = await componentFixture();
    const draft = componentDraft();
    expect(draft.coordinates).toEqual(["", "", ""]);
    const { value, errors } = buildComponentInput(head.snapshot, draft);
    expect(value).toBeNull();
    for (const key of ["name", "componentType", "sourceLocation", "sizeX", "sizeY", "sizeZ", "coordinate0", "coordinate1", "coordinate2", "evidence"]) expect(errors[key]).toBeTruthy();
    expect(errors.material).toBeUndefined();
  });
  it("修改后保留原有分数、参数、概念、位置依据和待确认条目", async () => {
    const { head, component } = await componentFixture();
    const base: ComponentInput = { ...component, solid: { kind: "box", sizeX: "100/3", sizeY: "240", sizeZ: "3000", centerMm: [-20, 0, 5] },
      parameters: [{ id: crypto.randomUUID(), name: "原有说明", valueType: "text", value: "保留", unit: "1", basis: "human", factRefs: [], evidenceRefs: component.evidenceRefs }],
      unknowns: [{ reasonCode: "source-missing", description: "内构造待补", requiredEvidence: ["局部详图"], affectedStableKeys: [component.stableKey], blocksProxyOutcome: false, blocksFormalEligibility: true }] };
    const draft = componentDraft(base); draft.name = "修订墙体";
    const { value, errors } = buildComponentInput(head.snapshot, draft, base);
    expect(errors).toEqual({});
    expect(value).toEqual({ ...base, displayNameZh: "修订墙体" });
  });
  it.each(["0", "-2", "", "NaN", "Infinity", "1/0", "1e999"])("无效长度 %s 不可保存", async (text) => {
    const { head, component } = await componentFixture(); const draft = componentDraft(component); draft.lengths.sizeX = text;
    expect(buildComponentInput(head.snapshot, draft, component).errors.sizeX).toBeTruthy();
  });
  it("尺寸引用读取当前采用值，失效不退回旧手填值", async () => {
    const { head, component, dimension } = await componentFixture();
    const draft = componentDraft(component); draft.bindings.sizeX = dimension.id; draft.lengths.sizeX = "999";
    expect(buildComponentInput(head.snapshot, draft, component).value?.solid).toMatchObject({ sizeX: "6000" });
    const next = structuredClone(dimension); next.id = crypto.randomUUID(); next.value = { ...(dimension.value as object), value: 6100 };
    head.snapshot.facts.push(next);
    const value = buildComponentInput(head.snapshot, draft, component).value!;
    expect(value.solid).toMatchObject({ sizeX: "6100" });
    expect(value.dimensionBindings).toEqual([{ field: "sizeX", sourceFactRef: dimension.id }]);
    next.reviewStatus = "rejected";
    expect(buildComponentInput(head.snapshot, draft, component).errors.sizeX).toContain("不再采用");
  });
  it.each([
    { kind: "cylinder", radius: "200", height: "3000", axis: "x", centerMm: [-2, 0, 3] },
    { kind: "extrudedProfile", depth: "200", axis: "y", originMm: [0, -10, 30], profileMm: [[0, 0], [20, 0], [20, 15], [0, 10]] },
  ] as ComponentInput["solid"][])("圆柱和轮廓挤出可无改动回存", async (solid) => {
    const { head, component } = await componentFixture(); const base = { ...component, solid };
    expect(buildComponentInput(head.snapshot, componentDraft(base), base).value).toEqual(base);
  });
  it.each([
    [["0", "0"], ["10", "0"], ["0", "0"]],
    [["0", "0"], ["10", "0"], ["20", "0"]],
    [["0", "0"], ["10", "10"], ["0", "10"], ["10", "0"]],
  ].map((points) => ({ points })))("重复点、零面积、自交均不可保存 %#", async ({ points }) => {
    const { head, component } = await componentFixture(); const draft = componentDraft(component);
    draft.kind = "extrudedProfile"; draft.lengths.depth = "100"; draft.profile = points as [string, string][];
    expect(buildComponentInput(head.snapshot, draft, component).errors.profile).toBeTruthy();
  });
  it("资料缺失和父级循环阻止保存，未知材料无说明可记录缺项", async () => {
    const { head, component } = await componentFixture(); const draft = componentDraft(component);
    draft.evidenceRefs = [crypto.randomUUID()]; draft.material = "未知"; draft.parentStableKey = component.stableKey;
    const errors = buildComponentInput(head.snapshot, draft, component).errors;
    expect(errors.evidence).toBeTruthy(); expect(errors.material).toBeUndefined(); expect(errors.parent).toContain("循环");
  });
  it("新增待确认说明明确标记影响正式资格，旧说明不丢失", async () => {
    const { head, component } = await componentFixture(); const draft = componentDraft(component);
    draft.material = "未知"; draft.unknownDescription = "材料待现场核查"; draft.requiredEvidence = "材料调查记录";
    const result = buildComponentInput(head.snapshot, draft, component);
    expect(result.errors).toEqual({});
    expect(result.value?.unknowns).toEqual(expect.arrayContaining([expect.objectContaining({ description: "材料待现场核查", blocksFormalEligibility: true })]));
  });
  it("空材料和明确未知自动记录材料缺项，保留其他未知且重复编辑不累加", async () => {
    const { head, component } = await componentFixture();
    const base = { ...component, unknowns: [{ reasonCode: "structure-missing", description: "内构造待核查", requiredEvidence: ["构造详图"], affectedStableKeys: [component.stableKey], blocksProxyOutcome: false, blocksFormalEligibility: true }] };
    for (const material of ["", "未知", "unknown"]) {
      const draft = componentDraft(base); draft.material = material;
      const value = buildComponentInput(head.snapshot, draft, base).value!;
      expect(value.materialCode).toBe("unknown");
      expect(value.unknowns).toEqual([base.unknowns[0], expect.objectContaining({ reasonCode: "material-unknown", requiredEvidence: ["材料调查记录"], blocksProxyOutcome: false, blocksFormalEligibility: true })]);
      expect(buildComponentInput(head.snapshot, componentDraft(value), value).value!.unknowns).toEqual(value.unknowns);
    }
  });
  it("有展示模型无输入记录时拒绝反写；最新已驳回输入不会复现旧记录", async () => {
    const { head, component } = await componentFixture();
    head.snapshot.geometrySpecs = [{} as ProjectHeadGeometry];
    expect(buildComponentInput(head.snapshot, componentDraft(component), component).errors.form).toContain("反写");
    const fact = FactEnvelopeSchema.parse({ ...head.snapshot.facts[0], id: crypto.randomUUID(), field: "geometry.component." + component.stableKey, value: component });
    head.snapshot.facts.push(fact);
    expect(componentInputs(head.snapshot)).toHaveLength(1);
    head.snapshot.facts.push({ ...fact, id: crypto.randomUUID(), reviewStatus: "rejected" });
    expect(componentInputs(head.snapshot)).toEqual([]);
  });
});
type ProjectHeadGeometry = Awaited<ReturnType<typeof componentFixture>>["head"]["snapshot"]["geometrySpecs"][number];

