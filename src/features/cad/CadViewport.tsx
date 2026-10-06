import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CadPreview } from '../../domain/geometry/cadPreview';

export default function CadViewport({
  preview,
  selected,
  selectionKind,
  onSelect,
  dark,
  onRendered,
}: {
  preview: CadPreview | null;
  selected: string[];
  selectionKind: 'face' | 'edge' | 'body';
  onSelect: (id: string, additive: boolean) => void;
  dark: boolean;
  onRendered?: (report: { nodes: number; triangles: number; drawCalls: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, selectionKind, onRendered });
  callbacks.current = { onSelect, selectionKind, onRendered };
  const [failure, setFailure] = useState<string | null>(null);
  const [fit, setFit] = useState(0);
  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailure('The graphics renderer is unavailable. The CAD definition remains editable.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(dark ? '#202323' : '#f6f6f3');
    renderer.domElement.setAttribute(
      'aria-label',
      'Exact CAD shape preview. Drag to orbit, scroll to zoom.',
    );
    setFailure(null);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.00001, 100000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.0);
    light.position.set(2, 3, 5);
    scene.add(light);
    const disposable: (THREE.BufferGeometry | THREE.Material)[] = [];
    let surface: THREE.Mesh | null = null,
      lines: THREE.LineSegments | null = null;
    const bounds = new THREE.Box3();
    if (preview) {
      const positions: number[] = [],
        colors: number[] = [];
      const normal = new THREE.Color(dark ? '#afb5b2' : '#b9c0bb'),
        highlight = new THREE.Color('#c8994a');
      for (let t = 0; t < preview.triangles.length / 3; t++) {
        const color =
          selected.includes(preview.faces[preview.triangleFaces[t]].id) ||
          (preview.bodies.length === 1 && selected.includes(preview.bodies[0].id))
            ? highlight
            : normal;
        for (let v = 0; v < 3; v++) {
          const i = preview.triangles[t * 3 + v] * 3;
          positions.push(preview.positions[i], preview.positions[i + 1], preview.positions[i + 2]);
          colors.push(color.r, color.g, color.b);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      surface = new THREE.Mesh(geometry, material);
      scene.add(surface);
      disposable.push(geometry, material);
      const edges: number[] = [],
        edgeColors: number[] = [];
      const edgeNormal = new THREE.Color(dark ? '#424b45' : '#5b665e');
      for (let s = 0; s < preview.edgeSegments.length / 2; s++) {
        const color = selected.includes(preview.edges[preview.segmentEdges[s]].id)
          ? highlight
          : edgeNormal;
        for (let v = 0; v < 2; v++) {
          const i = preview.edgeSegments[s * 2 + v] * 3;
          edges.push(
            preview.edgePositions[i],
            preview.edgePositions[i + 1],
            preview.edgePositions[i + 2],
          );
          edgeColors.push(color.r, color.g, color.b);
        }
      }
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
      const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
      lines = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(lines);
      disposable.push(lineGeometry, lineMaterial);
      const p = new THREE.Vector3();
      for (let i = 0; i < preview.positions.length; i += 3)
        bounds.expandByPoint(
          p.set(preview.positions[i], preview.positions[i + 1], preview.positions[i + 2]),
        );
    }
    if (bounds.isEmpty())
      bounds.set(new THREE.Vector3(-0.05, -0.05, -0.05), new THREE.Vector3(0.05, 0.05, 0.05));
    const center = bounds.getCenter(new THREE.Vector3()),
      span = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-6);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(1.3, -1.7, 1.2).multiplyScalar(span));
    camera.up.set(0, 0, 1);
    camera.near = span / 10000;
    camera.far = span * 1000;
    camera.updateProjectionMatrix();
    const ray = new THREE.Raycaster();
    ray.params.Line.threshold = span / 90;
    let start: [number, number] | null = null;
    const down = (event: PointerEvent) => {
      start = [event.clientX, event.clientY];
    };
    const up = (event: PointerEvent) => {
      if (!preview || !start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const kind = callbacks.current.selectionKind;
      if (kind === 'edge' && lines) {
        const hit = ray.intersectObject(lines)[0];
        if (hit?.index != null) {
          const entity = preview.edges[preview.segmentEdges[Math.floor(hit.index / 2)]];
          if (entity)
            callbacks.current.onSelect(entity.id, event.shiftKey || event.metaKey || event.ctrlKey);
        }
      } else if (surface) {
        const hit = ray.intersectObject(surface)[0];
        if (hit?.faceIndex != null) {
          const entity =
            kind === 'body' && preview.bodies.length === 1
              ? preview.bodies[0]
              : preview.faces[preview.triangleFaces[hit.faceIndex]];
          if (entity && (kind !== 'body' || preview.bodies.length === 1))
            callbacks.current.onSelect(entity.id, event.shiftKey || event.metaKey || event.ctrlKey);
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', up);
    const resize = () => {
      const w = Math.max(1, host.clientWidth),
        h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let frame = 0,
      reported = false;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      if (
        preview &&
        !reported &&
        host.clientWidth > 1 &&
        host.clientHeight > 1 &&
        renderer.info.render.calls > 0 &&
        renderer.info.render.triangles > 0
      ) {
        reported = true;
        callbacks.current.onRendered?.({
          nodes: preview.positions.length / 3,
          triangles: renderer.info.render.triangles,
          drawCalls: renderer.info.render.calls,
        });
      }
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      disposable.forEach((item) => item.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [preview, selected, dark, fit]);
  return (
    <div className="cad-viewport">
      <div ref={container} className="cad-graphics" />
      <button className="secondary cad-fit" onClick={() => setFit((n) => n + 1)}>
        Fit view
      </button>
      {failure && (
        <p role="alert" className="cad-empty-overlay">
          {failure}
        </p>
      )}
      {!preview && !failure && (
        <div className="cad-empty-overlay">
          <strong>Your geometry workspace</strong>
          <p>
            Create a sketch or solid, or import a STEP file. Evaluate to inspect its exact shape.
          </p>
        </div>
      )}
    </div>
  );
}
