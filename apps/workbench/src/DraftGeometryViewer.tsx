import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ComponentInput } from "./component-input";
import { draftGeometryMesh } from "./draft-geometry-mesh";
import "./DraftGeometryViewer.css";

export function DraftGeometryViewer({ component, onSelect }: { component: ComponentInput; onSelect: (stableKey: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [error, setError] = useState("");
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let disposed = false;
    const scene = new THREE.Scene();
    const clean = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls?.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
    };
    try {
      setError("");
      const mesh = draftGeometryMesh(component);
      scene.background = new THREE.Color(0xf4f5f3);
      scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x6d766d, 2.4));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x39413d }));
      edges.raycast = () => undefined;
      mesh.add(edges);
      const light = new THREE.DirectionalLight(0xffffff, 2.2);
      light.position.set(4, 7, 3);
      scene.add(light);
      const bounds = new THREE.Box3().setFromObject(mesh);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 0.01);
      const camera = new THREE.PerspectiveCamera(38, 1, Math.max(span / 10_000, 0.00001), span * 30);
      camera.position.copy(center).add(new THREE.Vector3(span * 1.8, span * 1.45, span * 1.8));
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.append(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.copy(center);
      controls.minDistance = span * 0.05;
      controls.maxDistance = span * 8;
      controls.update();
      const resize = () => {
        if (disposed || !renderer) return;
        const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const raycaster = new THREE.Raycaster();
      renderer.domElement.onclick = (event) => {
        const rect = renderer!.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
        if (raycaster.intersectObject(mesh, true).length) select.current(mesh.userData.stableKey as string);
      };
      renderer.domElement.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        if (!disposed) { cancelAnimationFrame(frame); setError("形体显示中断。参数和原件仍可查看，请重新预览。"); }
      });
      const animate = () => {
        if (disposed) return;
        try {
          controls?.update();
          renderer!.render(scene, camera);
          frame = requestAnimationFrame(animate);
        } catch { if (!disposed) setError("形体显示失败。参数和原件仍可查看，请重新预览。"); }
      };
      animate();
      container.dataset.viewerState = "loaded";
    } catch {
      clean();
      setError("无法显示待核对形体。参数和原件仍可查看，请重新预览。");
      container.dataset.viewerState = "error";
    }
    return clean;
  }, [component]);
  return <div className="draft-geometry-viewer"><div ref={host} className="draft-geometry-viewer__canvas" aria-label="待核对形体查看器" />{error && <p role="alert" className="gj-alert gj-alert--warning">{error}</p>}</div>;
}
