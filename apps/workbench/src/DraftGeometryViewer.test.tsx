import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Camera, Scene } from "three";
import type { DraftGeometryViewer as Viewer } from "./DraftGeometryViewer";
import type { ComponentInput } from "./component-input";

const state = { fail: false, renderers: [] as { canvas: HTMLCanvasElement; dispose: () => void }[], controls: [] as (() => void)[], observers: [] as (() => void)[] };
let DraftGeometryViewer: typeof Viewer;
beforeAll(async () => {
vi.doMock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    dispose = vi.fn();
    render = vi.fn((scene: Scene, camera: Camera) => { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); });
    outputColorSpace = "";
    constructor() {
      if (state.fail) throw new Error("WebGL unavailable");
      this.domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
      state.renderers.push({ canvas: this.domElement, dispose: this.dispose });
    }
    setPixelRatio() {}
    setSize() {}
  } };
});
vi.doMock("three/examples/jsm/controls/OrbitControls.js", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  return { OrbitControls: class {
  target = new actual.Vector3(); dispose = vi.fn(); enableDamping = false; minDistance = 0; maxDistance = 0;
  constructor(private camera: Camera) { state.controls.push(this.dispose); }
  update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(true); }
} }; });
DraftGeometryViewer = (await import("./DraftGeometryViewer")).DraftGeometryViewer;
});
function input(stableKey = "first"): ComponentInput {
  return { stableKey, displayNameZh: "测试墙体", componentType: "wall", materialCode: "unknown", parentStableKey: null, sourceLocation: "合成测试", evidenceRefs: [], solid: { kind: "box", sizeX: "2000", sizeY: "500", sizeZ: "1000", centerMm: [1500, 500, 1000] }, positionBasis: "human", parameters: [], unknowns: [] };
}
beforeEach(() => {
  state.fail = false; state.renderers = []; state.controls = []; state.observers = [];
  vi.stubGlobal("ResizeObserver", class { disconnect = vi.fn(); constructor() { state.observers.push(this.disconnect); } observe() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("临时形体渲染生命周期", () => {
  it("点击实际网格使用stableKey，更新回调不重建渲染资源", () => {
    const component = input();
    const first = vi.fn(), second = vi.fn();
    const view = render(<DraftGeometryViewer component={component} onSelect={first} />);
    fireEvent.click(state.renderers[0]!.canvas, { clientX: 50, clientY: 50 });
    expect(first).toHaveBeenCalledWith("first");
    view.rerender(<DraftGeometryViewer component={component} onSelect={second} />);
    fireEvent.click(state.renderers[0]!.canvas, { clientX: 50, clientY: 50 });
    expect(second).toHaveBeenCalledWith("first"); expect(state.renderers).toHaveLength(1);
  });
  it("换对象和卸载释放网格、边线、controls、observer及WebGL资源", () => {
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const disposeMaterial = vi.spyOn(THREE.Material.prototype, "dispose");
    const view = render(<DraftGeometryViewer component={input("first")} onSelect={vi.fn()} />);
    const oldCanvas = state.renderers[0]!.canvas;
    view.rerender(<DraftGeometryViewer component={input("second")} onSelect={vi.fn()} />);
    expect(state.renderers[0]!.dispose).toHaveBeenCalledOnce(); expect(oldCanvas.isConnected).toBe(false);
    expect(disposeGeometry).toHaveBeenCalledTimes(2); expect(disposeMaterial).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(state.renderers[1]!.dispose).toHaveBeenCalledOnce();
    state.controls.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    state.observers.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(disposeGeometry).toHaveBeenCalledTimes(4); expect(disposeMaterial).toHaveBeenCalledTimes(4);
  });
  it("WebGL建立失败显示可恢复错误，参数与原件交互仍保留", () => {
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    state.fail = true;
    const select = vi.fn();
    const view = render(<div><button>查看原件</button><DraftGeometryViewer component={input()} onSelect={select} /></div>);
    expect(screen.getByRole("alert")).toHaveTextContent("参数和原件仍可查看");
    expect(screen.getByRole("button", { name: "查看原件" })).toBeEnabled(); expect(select).not.toHaveBeenCalled();
    state.fail = false;
    view.rerender(<DraftGeometryViewer component={input("second")} onSelect={select} />);
    expect(disposeGeometry).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(state.renderers).toHaveLength(1);
  });
  it("WebGL上下文失效停止旧帧并显示原件仍可用", () => {
    render(<DraftGeometryViewer component={input()} onSelect={vi.fn()} />);
    fireEvent(state.renderers[0]!.canvas, new Event("webglcontextlost", { cancelable: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("显示中断");
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});
