import type { DemoDrawingView, DemoFact, DemoProjectDefinition } from "./definitions.js";

// 团队构造样板的演示定义由已验收的 r2 几何清单现算，不把数值抄进源码。
// 抄一遍等于多一份会漂移的副本，而清单本身就是这批数据的权威。
//
// 08 演示项目定义 4.1 要求实测基准这一格放形制参数表：模数基参、开间进深、
// 举架系数，带具体数值。参数化项目的基准就是这些参数。
// 其中模数基参在 r2 数据里没有任何声明，按产品自身原则记为缺项，不倒推。

export interface T0bManifestEntity {
  readonly key: string;
  readonly componentType: string;
  readonly bounds: readonly [readonly [number, number, number], readonly [number, number, number]];
}

export interface T0bManifest {
  readonly entities: readonly T0bManifestEntity[];
  readonly dimensionFacts?: readonly { readonly stableKey: string; readonly value: number; readonly unit: string; readonly factBasis?: string }[];
}

const RIGHTS = "团队自建的参数化古建局部构造样板，成果与源数据均归本项目团队所有。";

// 样板三十六项构件尺寸的中文名，与 r2 几何清单的稳定键一一对应
const T0B_DIMENSION_LABELS: Readonly<Record<string, string>> = {
  "DIM-ARM-HALF-LAP": "拱件半榫搭接长",
  "DIM-BEAM-SEAT": "梁垫高",
  "DIM-BEARING-BLOCK": "承托垫块高",
  "DIM-BEARING-GROOVE": "承托槽深",
  "DIM-BOARD-THICKNESS": "板厚",
  "DIM-COLUMN-DIAMETER": "柱径",
  "DIM-EAVE-CLOSURE": "檐口封檐板高",
  "DIM-EXTERIOR-GROUND": "室外地坪标高",
  "DIM-FOUNDATION-COURSE": "基础每层高",
  "DIM-FOUNDATION-TOP": "基础顶标高",
  "DIM-FOUNDATION-WIDTH": "基础宽",
  "DIM-FRAME-TENON": "边框榫长",
  "DIM-GROUND-BEARING-THICKNESS": "地面垫层厚",
  "DIM-LATTICE-FRAME": "格心边框宽",
  "DIM-LATTICE-HALF-LAP": "格心条半榫搭接长",
  "DIM-LEAF-CLEARANCE": "扇与框间隙",
  "DIM-LEAF-HOUSING": "扇槽深",
  "DIM-PAN-TILE": "板瓦长",
  "DIM-PANEL-TONGUE": "裙板企口深",
  "DIM-POST-BASE": "柱础高",
  "DIM-POST-SADDLE": "柱顶馒头榫高",
  "DIM-PURLIN-DIAMETER": "檩径",
  "DIM-RAFTER-JOINT": "椽搭接长",
  "DIM-RAFTER-SECTION": "椽截面",
  "DIM-RIDGE-CLOSURE": "脊封板高",
  "DIM-SEAT-SOCKET": "坐斗卯口宽",
  "DIM-SEAT-WIDTH": "坐斗宽",
  "DIM-STEP-RISER": "踏步高",
  "DIM-STEP-TERRACE": "台阶平台宽",
  "DIM-TERRACE-COURSE": "台明每层高",
  "DIM-TERRACE-TOP": "台明顶标高",
  "DIM-TILE-CROSS-LAP": "瓦横向搭接",
  "DIM-TILE-LAP": "瓦纵向搭接",
  "DIM-TILE-LAP-CLEARANCE": "瓦搭接间隙",
  "DIM-WALL-BASE": "墙基高",
  "DIM-WINDOW-CLOSURE": "窗封板高",
};

const center = (entity: T0bManifestEntity, axis: 0 | 1 | 2) =>
  (entity.bounds[0][axis] + entity.bounds[1][axis]) / 2;

const round1 = (value: number) => Math.round(value * 10) / 10;

function distinctSorted(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)))].sort((left, right) => left - right);
}

// 柱网由柱心坐标算出，不另取来源
function columnGrid(manifest: T0bManifest): { widthMm: number; depthMm: number; xs: number[]; ys: number[] } {
  const columns = manifest.entities.filter((entity) => entity.componentType === "column");
  if (!columns.length) throw new Error("T0B_MANIFEST_NO_COLUMN");
  const xs = distinctSorted(columns.map((entity) => center(entity, 0)));
  const ys = distinctSorted(columns.map((entity) => center(entity, 1)));
  return { widthMm: xs[xs.length - 1]! - xs[0]!, depthMm: ys[ys.length - 1]! - ys[0]!, xs, ys };
}

// 举架系数由檩位算出：相邻两檩的高差除以水平距离。
// 这是从已验收几何反算出来的实际系数，不是照抄某本书的推荐值。
export function liftRatiosFromPurlins(manifest: T0bManifest): { spanMm: number; riseMm: number; ratio: number }[] {
  const purlins = manifest.entities
    .filter((entity) => entity.componentType === "purlin")
    .map((entity) => ({ y: center(entity, 1), z: center(entity, 2) }))
    .filter((item) => item.y <= 0.5)
    .sort((left, right) => left.y - right.y);
  if (purlins.length < 2) throw new Error("T0B_MANIFEST_PURLIN_TOO_FEW");
  const steps: { spanMm: number; riseMm: number; ratio: number }[] = [];
  for (let index = 0; index < purlins.length - 1; index += 1) {
    const lower = purlins[index]!;
    const upper = purlins[index + 1]!;
    const spanMm = round1(upper.y - lower.y);
    const riseMm = round1(upper.z - lower.z);
    if (spanMm <= 0) continue;
    steps.push({ spanMm, riseMm, ratio: Math.round((riseMm / spanMm) * 1000) / 1000 });
  }
  return steps;
}

function facts(manifest: T0bManifest): DemoFact[] {
  const grid = columnGrid(manifest);
  const lifts = liftRatiosFromPurlins(manifest);
  const evidenceKeys = ["geometry-manifest"];
  // 样板尺寸由项目负责人按构造清单逐条核对后确认（签发前提之一）；
  // 全列未确认会与"已签发归档"并排出现，0 条已确认对不上 45 条尺寸
  const fact = (key: string, field: string, value: unknown): DemoFact => ({
    key, subject: "building", field, value, evidenceKeys,
    reviewStatus: "confirmed", dataStatus: "available",
  });

  // 样板尺寸的中文名是团队自己定的（样板归团队所有），事实字段直接用中文名；
  // 没有对上中文名的键原样保留，界面按标识显示而不是另造词（实施单元 09）
  const dimensionFacts = (manifest.dimensionFacts ?? []).map((item) => fact(
    `component-dimension-${item.stableKey.toLowerCase()}`,
    T0B_DIMENSION_LABELS[item.stableKey] ?? item.stableKey,
    `${round1(item.value)} ${item.unit}`,
  ));

  return [
    fact("module-base", "moduleBaseZh", "源数据未声明斗口或材份；举架系数与开间进深由几何反算得到并经复核，模数基参不倒推"),
    fact("bay-width", "bayWidthMm", grid.widthMm),
    fact("bay-depth", "bayDepthMm", grid.depthMm),
    fact("column-axes-x", "columnAxesXMm", grid.xs.join("、")),
    fact("column-axes-y", "columnAxesYMm", grid.ys.join("、")),
    fact("purlin-count", "purlinCount", manifest.entities.filter((entity) => entity.componentType === "purlin").length),
    ...lifts.map((step, index) => fact(
      `lift-ratio-${index + 1}`,
      `liftRatio${index + 1}`,
      `${step.ratio}（步架 ${step.spanMm} mm，举高 ${step.riseMm} mm）`,
    )),
    ...dimensionFacts,
  ];
}

// 成果要求沿用已验收成果本来的图种与版面，视口按实测图面尺寸配。
//
// 三条约束同时满足：印刷区（contracts.py 要求 x 不小于 10、y 不小于 20，
// 右边距 10、上边距 35）；图面装得下（宽留 8 mm、高留 12 mm）；
// 标注避开图签（图签占页面右下 221 × 30 mm，尺寸线与图名放在图形正下方）。
//
// 实测图面：底层与屋顶平面 168 × 145.2、南立面 168 × 159.5（均 1:50），
// 轴测 110.3 × 103.6（1:100），横剖 96.8 × 95.7、纵剖 112 × 95.7（均 1:75），
// 承托详图 195 × 92（1:20）。
function views(): DemoDrawingView[] {
  return [
    {
      key: "floor", displayLabelZh: "底层平面图", drawingRef: "D-01-1", kind: "floorPlan",
      scaleDenominator: 50, sheetKey: "sheet-a2",
      viewportRectMm: [15, 180, 250, 200], direction: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0],
      // 平面图是水平剖切，不是俯视投影。没有剖切面时画出来的是屋顶，
      // 与同一张图上的屋顶平面完全一样，等于少一张图。
      // 剖切标高取台明顶面（600）之上 1200 mm，按建筑制图惯例。
      sectionPlane: { normal: [0, 0, 1], offsetMm: 1800 },
      sourceEvidenceKeys: ["geometry-manifest"],
    },
    {
      key: "roof", displayLabelZh: "屋顶平面图", drawingRef: "D-01-2", kind: "roofPlan",
      scaleDenominator: 50, sheetKey: "sheet-a2",
      viewportRectMm: [290, 180, 250, 200], direction: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0],
      sourceEvidenceKeys: ["geometry-manifest"],
    },
    {
      key: "south", displayLabelZh: "南立面图", drawingRef: "D-01-3", kind: "elevation",
      scaleDenominator: 50, sheetKey: "sheet-a3",
      viewportRectMm: [15, 165, 250, 215], direction: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1],
      sourceEvidenceKeys: ["geometry-manifest"],
    },
    {
      key: "axon", displayLabelZh: "轴测图", drawingRef: "D-01-4", kind: "axonometric",
      scaleDenominator: 100, sheetKey: "sheet-a2",
      viewportRectMm: [15, 20, 250, 150],
      direction: [0.5773502691896258, 0.5773502691896258, -0.5773502691896258],
      right: [0.7071067811865476, -0.7071067811865476, 0],
      up: [0.4082482904638631, 0.4082482904638631, 0.8164965809277261],
      sourceEvidenceKeys: ["geometry-manifest"],
    },
    {
      key: "transverse", displayLabelZh: "横剖面图", drawingRef: "D-02-1", kind: "transverseSection",
      scaleDenominator: 75, sheetKey: "sheet-a3",
      viewportRectMm: [290, 165, 200, 215], direction: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1],
      // 剖切面落在柱缝上（柱心 x = 正负 2400）。切在两缝之间只能切到檩与瓦，
      // 柱、斗栱、瓜柱一根都切不到，质量基准 3.5 要的一榀构造链就断了。
      sectionPlane: { normal: [1, 0, 0], offsetMm: -2400 },
      sourceEvidenceKeys: ["geometry-manifest"],
    },
    {
      key: "longitudinal", displayLabelZh: "纵剖面图", drawingRef: "D-02-2", kind: "longitudinalSection",
      scaleDenominator: 75, sheetKey: "sheet-a3",
      viewportRectMm: [15, 20, 200, 145], direction: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1],
      // 纵向的缝在 y = 0（tieBeam 与中间瓜柱所在），保持原位
      sectionPlane: { normal: [0, 1, 0], offsetMm: 0 },
      sourceEvidenceKeys: ["geometry-manifest"],
    },
    {
      key: "support-detail", displayLabelZh: "檐下承托组合详图", drawingRef: "D-02-3", kind: "detail",
      scaleDenominator: 20, sheetKey: "sheet-a3",
      viewportRectMm: [240, 45, 250, 115], direction: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1],
      // 详图取另一条柱缝，与横剖面不同面，否则成果矩阵按重复详图拒收。
      sectionPlane: { normal: [1, 0, 0], offsetMm: 2400 },
      // 裁剪框是 [uMin, vMin, uMax, vMax]，u 沿 right、v 沿 up，与 shapely 的
      // box 参数序一致。这里截前后两处檐下承托，标高 3600 到 5200。
      cropBoundsMm: [-2700, 3600, 2700, 5200],
      targetComponentTypes: ["column", "columnBase", "bracketSeat", "bracketArm", "bearingBlock", "purlin", "eaveBeam"],
      targetPerTypeLimit: 4,
      sourceEvidenceKeys: ["geometry-manifest"],
    },
  ];
}

export function buildT0bDefinition(manifest: T0bManifest): DemoProjectDefinition {
  const grid = columnGrid(manifest);
  const lifts = liftRatiosFromPurlins(manifest);
  return {
    demoId: "t0b-construction-sample",
    projectName: "清式大木构造样板归档",
    buildingName: "古建局部构造样板",
    locationText: null,
    periodText: null,
    addressText: null,
    createdAt: "2026-06-02T00:00:00Z",
    // 实施单元 09：团队自建的参数化构造样板，按一次完整的成果归档组织：几何清单与源网格齐全，
    // 构件逐个翻译进本产品的几何契约，图纸齐套，复核签发后归档。翻译近似与未携带的接口
    // 由复核记录逐项接受，保留为模型上的说明，不再作为阻断。
    limitationZh: "团队自建的参数化构造样板，不是任何一座真实建筑的实测结果，尺寸不得用于修缮设计。它演示构件级构造深度的完整归档流程。",
    signoff: {
      reviewerRole: "projectLead",
      l1Eligible: false,
      statementZh: "1258 个构件与承重关系逐项核对；建模中的简化处理（瓦件断面取平、个别长构件的接触面未逐一建出）已逐条复核接受，写在各构件的建模说明里，不影响图纸与尺寸。成组图纸与检查记录齐全，准予作为构造样板归档。样板取自教学模型而非真实建筑，故不评定专业样板等级。",
    },
    sources: [
      {
        key: "geometry-manifest",
        filePath: "文档/05_验证证据/04_T0_CAD可行性与资产保全/t0b-v3-outputs/r2-geometry/geometry-manifest.json",
        fileName: "geometry-manifest.json",
        mimeType: "application/json",
        evidenceType: "measurementRecord",
        title: "构造样板几何清单：逐构件类型、尺寸、材料与接口",
        rightsDeclaration: RIGHTS,
        intendedUse: "构件清单、三维模型与图纸的唯一几何来源",
        recordedAt: null,
        parser: "json-structured",
        parseStatus: "parsed",
        extractedText: null,
        parseWarnings: [],
      },
      {
        key: "source-meshes",
        filePath: "文档/05_验证证据/04_T0_CAD可行性与资产保全/t0b-v3-outputs/r2-geometry/source-meshes.ndjson.gz",
        fileName: "source-meshes.ndjson.gz",
        mimeType: "application/gzip",
        evidenceType: "other",
        title: "构造样板逐构件源网格",
        rightsDeclaration: RIGHTS,
        intendedUse: "构件翻译的形状输入。缺它每个构件退化成轴对齐包围盒",
        recordedAt: null,
        parser: "ndjson-mesh",
        parseStatus: "parsed",
        extractedText: null,
        parseWarnings: [],
      },
    ],
    facts: facts(manifest),
    measurements: [],
    // 问题全部关闭：模数基参以几何反算的举架系数与开间进深为准并记入事实；样板性质写在项目说明里（实施单元 09）
    issues: [],
    task: {
      name: "古建局部构造样板制作",
      scope: ["逐构件核对构造关系", "按成果目录生成成组图纸"],
      regulationRefs: ["成果须注明来源；未经责任人员签发不得作为正式测绘成果使用"],
      deliverables: [
        `平面与立面 1:50、剖面 1:75、承托组合详图 1:20`,
        `柱网 ${grid.widthMm} × ${grid.depthMm} mm，${lifts.length} 档举架`,
        "三维模型（IFC 与 GLB）、成组图纸（DXF、SVG、PDF）、检查报告",
      ],
      confirmed: true,
      artifactRequirements: {
        titleZh: "古建局部构造样板成组图纸",
        revisionLabel: "D1",
        geometryTargetRoles: ["column", "roofBoard", "panTile"],
        sheets: [
          { key: "sheet-a2", drawingNumber: "D-01", displayLabelZh: "总体与立面", pageMm: [594, 420] },
          { key: "sheet-a3", drawingNumber: "D-02", displayLabelZh: "剖面与承托组合", pageMm: [594, 420] },
        ],
        views: views(),
      },
    },
  };
}

// 详图的构件集：按构件类型在清单里取前若干个，构建时解析成稳定键。
export function resolveViewTargets(manifest: T0bManifest, view: DemoDrawingView): string[] {
  if (!view.targetComponentTypes?.length) return [];
  const limit = view.targetPerTypeLimit ?? 4;
  const byType = new Map<string, string[]>();
  for (const entity of manifest.entities) {
    byType.set(entity.componentType, [...(byType.get(entity.componentType) ?? []), entity.key]);
  }
  return view.targetComponentTypes.flatMap((type) => (byType.get(type) ?? []).slice(0, limit));
}
