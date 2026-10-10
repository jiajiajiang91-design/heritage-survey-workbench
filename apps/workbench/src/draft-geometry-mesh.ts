import * as THREE from "three";
import type { ComponentInput } from "./component-input";

function length(value: string): number {
  const [numerator, denominator = "1"] = value.split("/");
  const number = Number(numerator) / Number(denominator);
  if (!Number.isFinite(number) || number <= 0) throw new Error("形体长度必须为有效正数。");
  return number;
}

export function draftGeometryMesh(component: ComponentInput) {
  const solid = component.solid;
  let geometry: THREE.BufferGeometry;
  if (solid.kind === "box") {
    geometry = new THREE.BoxGeometry(length(solid.sizeX), length(solid.sizeY), length(solid.sizeZ));
  } else if (solid.kind === "cylinder") {
    geometry = new THREE.CylinderGeometry(length(solid.radius), length(solid.radius), length(solid.height), 64);
    if (solid.axis === "x") geometry.rotateZ(-Math.PI / 2);
    if (solid.axis === "z") geometry.rotateX(Math.PI / 2);
  } else {
    const shape = new THREE.Shape(solid.profileMm.map(([u, v]) => new THREE.Vector2(u, v)));
    geometry = new THREE.ExtrudeGeometry(shape, { depth: length(solid.depth), bevelEnabled: false, steps: 1 });
    if (solid.axis === "x") geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    if (solid.axis === "y") geometry.rotateX(Math.PI / 2);
  }
  const position = solid.kind === "extrudedProfile" ? solid.originMm : solid.centerMm;
  geometry.translate(...position);
  // CAD 的 Z 向上毫米坐标统一换成视口的 Y 向上米坐标。
  geometry.applyMatrix4(new THREE.Matrix4().set(0.001, 0, 0, 0, 0, 0, 0.001, 0, 0, -0.001, 0, 0, 0, 0, 0, 1));
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x879c91, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  mesh.name = component.stableKey;
  mesh.userData = { stableKey: component.stableKey, displayNameZh: component.displayNameZh, state: "pending-review" };
  return mesh;
}
