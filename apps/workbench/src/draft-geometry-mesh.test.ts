import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ComponentInput } from "./component-input";
import { draftGeometryMesh } from "./draft-geometry-mesh";

function input(solid: ComponentInput["solid"], stableKey = "wall-preview") : ComponentInput {
  return { stableKey, displayNameZh: "待核对测试构件", componentType: "wall", materialCode: "unknown", parentStableKey: null, sourceLocation: "合成几何测试", evidenceRefs: [], solid, positionBasis: "human", parameters: [], unknowns: [] };
}
function inspect(component: ComponentInput) {
  const mesh = draftGeometryMesh(component);
  expect(mesh.name).toBe(component.stableKey);
  expect(mesh.userData.stableKey).toBe(component.stableKey);
  expect(mesh.userData).not.toHaveProperty("geometryRevisionId");
  const box = new THREE.Box3().setFromObject(mesh);
  const result = { min: box.min.toArray(), max: box.max.toArray(), center: box.getCenter(new THREE.Vector3()).toArray() };
  mesh.geometry.dispose(); mesh.material.dispose();
  return result;
}
function close(actual: number[], expected: number[]) { actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6)); }
describe("临时形体与 CAD 坐标一致", () => {
  it("长方体围绕中心，毫米只换算一次并映射视口轴", () => {
    const result = inspect(input({ kind: "box", sizeX: "6100.5", sizeY: "1200", sizeZ: "3000", centerMm: [250, -700, 1800] }));
    close(result.min, [-2.80025, 0.3, 0.1]); close(result.max, [3.30025, 3.3, 1.3]); close(result.center, [0.25, 1.8, 0.7]);
  });
  it.each(["x", "y", "z"] as const)("圆柱沿 %s 正轴，范围与中心符合 CAD", (axis) => {
    const result = inspect(input({ kind: "cylinder", radius: "200", height: "1500", axis, centerMm: [300, -500, 1000] }));
    const ranges = { x: [[-0.45, 0.8, 0.3], [1.05, 1.2, 0.7]], y: [[0.1, 0.8, -0.25], [0.5, 1.2, 1.25]], z: [[0.1, 0.25, 0.3], [0.5, 1.75, 0.7]] };
    close(result.min, ranges[axis][0]!); close(result.max, ranges[axis][1]!); close(result.center, [0.3, 1, 0.5]);
  });
  it.each(["x", "y", "z"] as const)("轮廓挤出 %s 保留原点，U/V/T 方向及范围符合 CAD", (axis) => {
    const result = inspect(input({ kind: "extrudedProfile", axis, depth: "1500", originMm: [300, -500, 1000], profileMm: [[100, 200], [500, 200], [500, 800], [100, 800]] }));
    const ranges = { x: [[0.3, 1.2, 0], [1.8, 1.8, 0.4]], y: [[0.4, 1.2, 0.5], [0.8, 1.8, 2]], z: [[0.4, 1, -0.3], [0.8, 2.5, 0.3]] };
    close(result.min, ranges[axis][0]!); close(result.max, ranges[axis][1]!);
    close(result.center, ranges[axis][0]!.map((value, index) => (value + ranges[axis][1]![index]!) / 2));
  });
  it("两个对象身份独立，修改参数保持原 stableKey", () => {
    const first = input({ kind: "box", sizeX: "1000", sizeY: "500", sizeZ: "750", centerMm: [0, 0, 0] }, "first");
    const second = input({ kind: "cylinder", radius: "100", height: "900", axis: "z", centerMm: [5000, 0, 0] }, "second");
    const a = draftGeometryMesh(first), b = draftGeometryMesh(second);
    expect(a.name).not.toBe(b.name); expect(new THREE.Box3().setFromObject(a).intersectsBox(new THREE.Box3().setFromObject(b))).toBe(false);
    const modified = draftGeometryMesh({ ...first, solid: { ...first.solid, kind: "box", sizeX: "2000", sizeY: "500", sizeZ: "750", centerMm: [0, 0, 0] } });
    expect(modified.name).toBe(a.name); expect(modified.uuid).not.toBe(a.uuid);
    for (const mesh of [a, b, modified]) { mesh.geometry.dispose(); mesh.material.dispose(); }
  });
});
