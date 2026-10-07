import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Focus, Maximize, MousePointer2 } from 'lucide-react';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import type { CadAuthoringGuide } from './authoringGuide';
import { cadBodyAtTriangle, cadLegacyBodyId, cadVisiblePrimitives } from './cadVisibility';
import {
  cadFrameHeight,
  cadBoundsVisible,
  cadNextPick,
  cadSelectionBounds,
  type CadPickCycle,
} from './cadNavigation';

type SelectionKind = 'face' | 'edge' | 'body';
type View = 'iso' | 'front' | 'top' | 'right';
type Graphics = {
  surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  fit: (view?: View, selection?: boolean) => void;
  triangleSources: number[];
  segmentSources: number[];
};

export default function CadViewport({
  preview,
  guide = null,
  definitionPresent = false,
  stale = false,
  provisional = false,
  selected,
  hiddenBodies = [],
  selectionKind,
  onSelectionKind,
  onSelect,
  onClearSelection,
  dark,
  onRendered,
}: {
  preview: CadPreview | null;
  guide?: CadAuthoringGuide | null;
  definitionPresent?: boolean;
  stale?: boolean;
  provisional?: boolean;
  selected: string[];
  hiddenBodies?: string[];
  selectionKind: SelectionKind;
  onSelectionKind: (kind: SelectionKind) => void;
  onSelect: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
  dark: boolean;
  onRendered?: (report: { nodes: number; triangles: number; drawCalls: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const graphics = useRef<Graphics | null>(null);
  const savedCamera = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    up: THREE.Vector3;
    zoom: number;
    halfHeight: number;
    bounds: THREE.Box3;
  } | null>(null);
  const callbacks = useRef({
    onSelect,
    onClearSelection,
    selectionKind,
    stale,
    provisional,
    onRendered,
    selected,
    hiddenBodies,
  });
  callbacks.current = {
    onSelect,
    onClearSelection,
    selectionKind,
    stale,
    provisional,
    onRendered,
    selected,
    hiddenBodies,
  };
  const [failure, setFailure] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [style, setStyle] = useState<'edges' | 'shaded' | 'wireframe'>('edges');
  const [view, setView] = useState<View | 'custom'>('iso');
  const [generation, setGeneration] = useState(0);
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
    renderer.setClearColor(dark ? '#202323' : '#f4f5f3');
    renderer.domElement.setAttribute(
      'aria-label',
      'CAD model view. Left drag orbits; right drag pans; wheel zooms; click selects; Shift adds to selection. Alt-click cycles overlapping entities. F fits the model; Shift+F fits selection; 1 to 4 choose standard views.',
    );
    renderer.domElement.setAttribute('tabindex', '0');
    setFailure(null);
    setHovered(null);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.00001, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(2, -3, 5);
    scene.add(light);
    const disposable: (THREE.BufferGeometry | THREE.Material)[] = [];
    let surface: Graphics['surface'] = null,
      edges: Graphics['edges'] = null;
    const bounds = new THREE.Box3();
    if (preview) {
      const positions = new Float32Array(preview.triangles.length * 3);
      for (let i = 0; i < preview.triangles.length; i++) {
        const source = preview.triangles[i] * 3;
        positions.set(preview.positions.subarray(source, source + 3), i * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(positions.length), 3),
      );
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      surface = new THREE.Mesh(geometry, material);
      scene.add(surface);
      disposable.push(geometry, material);
      const edgeVertices = new Float32Array(preview.edgeSegments.length * 3);
      for (let i = 0; i < preview.edgeSegments.length; i++) {
        const source = preview.edgeSegments[i] * 3;
        edgeVertices.set(preview.edgePositions.subarray(source, source + 3), i * 3);
      }
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(edgeVertices, 3));
      lineGeometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(edgeVertices.length), 3),
      );
      const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
      edges = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(edges);
      disposable.push(lineGeometry, lineMaterial);
      const point = new THREE.Vector3();
      for (let i = 0; i < preview.positions.length; i += 3)
        bounds.expandByPoint(
          point.set(preview.positions[i], preview.positions[i + 1], preview.positions[i + 2]),
        );
    }
    if (guide) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(guide.positions, 3));
      const material = new THREE.LineDashedMaterial({
        color: dark ? '#9dbde3' : '#345a8d',
        dashSize: 0.002,
        gapSize: 0.001,
      });
      const outline = new THREE.LineSegments(geometry, material);
      outline.computeLineDistances();
      scene.add(outline);
      disposable.push(geometry, material);
      const point = new THREE.Vector3();
      for (let i = 0; i < guide.positions.length; i += 3)
        bounds.expandByPoint(
          point.set(guide.positions[i], guide.positions[i + 1], guide.positions[i + 2]),
        );
    }
    if (bounds.isEmpty())
      bounds.set(new THREE.Vector3(-0.05, -0.05, -0.05), new THREE.Vector3(0.05, 0.05, 0.05));
    const span = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-6);
    let halfHeight = span * 0.65;
    const projectCamera = () => {
      const aspect = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
    };
    const fit = (next?: View, selection = false) => {
      const visibleBounds = preview
        ? cadSelectionBounds(
            preview,
            callbacks.current.hiddenBodies,
            selection ? callbacks.current.selected : [],
          )
        : bounds;
      // Hidden or stale selections must not refocus an invisible body.
      if (visibleBounds.isEmpty()) return;
      const center = visibleBounds.getCenter(new THREE.Vector3());
      const direction =
        next === 'front'
          ? new THREE.Vector3(0, 0, 1)
          : next === 'top'
            ? new THREE.Vector3(0, -1, 0)
            : next === 'right'
              ? new THREE.Vector3(1, 0, 0)
              : next === 'iso'
                ? new THREE.Vector3(1.3, -1.7, 1.2).normalize()
                : camera.position.clone().sub(controls.target).normalize();
      if (next) camera.up.set(0, next === 'front' ? 1 : 0, next === 'front' ? 0 : 1);
      halfHeight = cadFrameHeight(
        visibleBounds,
        direction,
        camera.up,
        Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
      );
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, span * 3);
      camera.zoom = 1;
      projectCamera();
      controls.update();
    };
    camera.near = span / 10000;
    camera.far = span * 1000;
    fit('iso');
    if (savedCamera.current && (preview || guide)) {
      camera.position.copy(savedCamera.current.position);
      camera.up.copy(savedCamera.current.up);
      camera.zoom = savedCamera.current.zoom;
      halfHeight = savedCamera.current.halfHeight;
      controls.target.copy(savedCamera.current.target);
      projectCamera();
      controls.update();
      camera.updateMatrixWorld();
      if (!bounds.equals(savedCamera.current.bounds) && !cadBoundsVisible(bounds, camera)) fit();
    }
    graphics.current = { surface, edges, fit, triangleSources: [], segmentSources: [] };
    setGeneration((n) => n + 1);
    const ray = new THREE.Raycaster();
    const hitEntities = (event: PointerEvent) => {
      if (!preview || callbacks.current.stale || callbacks.current.provisional) return [];
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      // Keep edge targeting at a stable screen-pixel distance through zoom and resize.
      ray.params.Line.threshold = (halfHeight * 12) / (Math.max(rect.height, 1) * camera.zoom);
      const kind = callbacks.current.selectionKind;
      if (kind === 'edge' && edges) {
        return ray.intersectObject(edges).flatMap((hit) => {
          if (hit.index == null) return [];
          const source =
            graphics.current?.segmentSources[Math.floor(hit.index / 2)] ??
            Math.floor(hit.index / 2);
          const entity = preview.edges[preview.segmentEdges[source]];
          return entity ? [entity.id] : [];
        });
      }
      return surface
        ? ray.intersectObject(surface).flatMap((hit) => {
            if (hit.faceIndex == null) return [];
            const source = graphics.current?.triangleSources[hit.faceIndex] ?? hit.faceIndex;
            const entity =
              kind === 'body'
                ? cadBodyAtTriangle(preview, source)
                : preview.faces[preview.triangleFaces[source]];
            return entity ? [entity.id] : [];
          })
        : [];
    };
    let pickCycle: CadPickCycle | null = null;
    let start: [number, number] | null = null;
    const down = (event: PointerEvent) => {
      start = event.button === 0 ? [event.clientX, event.clientY] : null;
    };
    const move = (event: PointerEvent) => {
      if (!event.buttons) setHovered(hitEntities(event)[0] ?? null);
      else if (
        event.buttons === 1 &&
        start &&
        Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4
      )
        setView('custom');
    };
    const leave = () => setHovered(null);
    const up = (event: PointerEvent) => {
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) {
        start = null;
        return;
      }
      start = null;
      pickCycle = cadNextPick(
        pickCycle,
        hitEntities(event),
        event.clientX,
        event.clientY,
        callbacks.current.selectionKind,
        event.altKey,
      );
      const entity = pickCycle.ids[pickCycle.index];
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (entity) callbacks.current.onSelect(entity, additive);
      else if (!additive) callbacks.current.onClearSelection();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') callbacks.current.onClearSelection();
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        fit(undefined, event.shiftKey && !callbacks.current.stale);
      }
      const standard = ({ '1': 'iso', '2': 'front', '3': 'top', '4': 'right' } as const)[
        event.key as '1' | '2' | '3' | '4'
      ];
      if (standard && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        fit(standard);
        setView(standard);
      }
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerleave', leave);
    renderer.domElement.addEventListener('keydown', keyboard);
    const resize = () => {
      const w = Math.max(1, host.clientWidth),
        h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h);
      projectCamera();
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
        !callbacks.current.provisional &&
        host.clientWidth > 1 &&
        host.clientHeight > 1 &&
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
      savedCamera.current =
        preview || guide
          ? {
              position: camera.position.clone(),
              target: controls.target.clone(),
              up: camera.up.clone(),
              zoom: camera.zoom,
              halfHeight,
              bounds: bounds.clone(),
            }
          : null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      graphics.current = null;
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener('keydown', keyboard);
      disposable.forEach((item) => item.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [preview, guide, dark]);
  useEffect(() => {
    const current = graphics.current;
    if (!current || !preview) return;
    const visible = cadVisiblePrimitives(preview, hiddenBodies);
    current.triangleSources = visible.triangles;
    current.segmentSources = visible.segments;
    current.surface?.geometry.setIndex(
      visible.triangles.flatMap((i) => [i * 3, i * 3 + 1, i * 3 + 2]),
    );
    current.edges?.geometry.setIndex(visible.segments.flatMap((i) => [i * 2, i * 2 + 1]));
  }, [preview, hiddenBodies, generation]);
  useEffect(() => {
    const current = graphics.current;
    if (!current || !preview) return;
    const normal = new THREE.Color(dark ? '#aebbb6' : '#b8c8c2'),
      edgeNormal = new THREE.Color(dark ? '#546b61' : '#455e54');
    const picked = new THREE.Color('#c8994a'),
      hover = new THREE.Color('#65aaa5');
    const colorFor = (id: string, base: THREE.Color) =>
      selected.includes(id) ? picked : hovered === id ? hover : base;
    if (current.surface) {
      const legacyBodyId = cadLegacyBodyId(preview);
      const colors = current.surface.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < preview.triangleFaces.length; i++) {
        const face = preview.faces[preview.triangleFaces[i]].id;
        const body = preview.faces[preview.triangleFaces[i]].bodyId ?? legacyBodyId ?? '';
        const color =
          selected.includes(body) || hovered === body
            ? colorFor(body, normal)
            : colorFor(face, normal);
        for (let j = 0; j < 3; j++) colors.setXYZ(i * 3 + j, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
      current.surface.material.wireframe = style === 'wireframe';
      current.surface.material.transparent = stale;
      current.surface.material.opacity = stale ? 0.45 : 1;
    }
    if (current.edges) {
      const colors = current.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < preview.segmentEdges.length; i++) {
        const color = colorFor(preview.edges[preview.segmentEdges[i]].id, edgeNormal);
        colors.setXYZ(i * 2, color.r, color.g, color.b);
        colors.setXYZ(i * 2 + 1, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
      current.edges.visible = style === 'edges' || selectionKind === 'edge';
      current.edges.material.transparent = stale;
      current.edges.material.opacity = stale ? 0.45 : 1;
    }
  }, [preview, selected, hovered, dark, style, selectionKind, stale, generation]);
  const hoverName =
    preview &&
    [...preview.faces, ...preview.edges, ...preview.bodies].find((item) => item.id === hovered)
      ?.name;
  return (
    <div className="cad-viewport">
      <div ref={container} className="cad-graphics" />
      <div className="cad-model-tools" role="toolbar" aria-label="Model view controls">
        <div className="cad-tool-group">
          <MousePointer2 size={14} />
          {(['face', 'edge', 'body'] as const).map((kind) => (
            <button
              key={kind}
              aria-pressed={selectionKind === kind}
              disabled={
                !preview || stale || provisional || (kind === 'body' && preview.bodies.length === 0)
              }
              onClick={() => onSelectionKind(kind)}
            >
              {kind === 'face' ? 'Faces' : kind === 'edge' ? 'Edges' : 'Bodies'}
            </button>
          ))}
        </div>
        <div className="cad-tool-group">
          {(['iso', 'front', 'top', 'right'] as const).map((next) => (
            <button
              key={next}
              aria-pressed={view === next}
              onClick={() => {
                setView(next);
                graphics.current?.fit(next);
              }}
            >
              {next === 'iso'
                ? 'Isometric'
                : next === 'front'
                  ? 'Front · XY'
                  : next === 'top'
                    ? 'Top · XZ'
                    : 'Right · YZ'}
            </button>
          ))}
        </div>
        <button
          aria-label="Fit CAD model to view"
          title="Fit visible model (F) · preserves view direction"
          onClick={() => {
            graphics.current?.fit();
          }}
        >
          <Maximize size={15} />
        </button>
        <button
          aria-label="Fit selected CAD entities to view"
          title="Fit selection (Shift+F)"
          disabled={!selected.length || stale || !preview}
          onClick={() => graphics.current?.fit(undefined, true)}
        >
          <Focus size={15} />
        </button>
        <select
          aria-label="CAD display style"
          value={style}
          onChange={(event) => setStyle(event.target.value as typeof style)}
        >
          <option value="edges">Shaded + edges</option>
          <option value="shaded">Shaded</option>
          <option value="wireframe">Wireframe</option>
        </select>
      </div>
      {guide && (
        <div className="cad-guide-banner" role="status">
          {guide.label}
          {guide.truncated ? ' · bounded display' : ''}
        </div>
      )}
      {provisional && (
        <div className="cad-guide-banner" role="status">
          Command preview · Apply to keep this shape
        </div>
      )}
      {stale && (
        <div className="cad-stale-banner" role="status">
          Previous shape · rebuild to view your latest edits
        </div>
      )}
      <div className="cad-view-footer">
        <span>
          {hoverName ??
            (selected.length
              ? `${selected.length} selected · Esc clears selection`
              : 'Drag to orbit · right drag to pan · Alt-click to pick through')}
        </span>
        <span>F · Fit view &nbsp; Shift+F · Fit selection</span>
      </div>
      {failure && (
        <p role="alert" className="cad-empty-overlay">
          {failure}
        </p>
      )}
      {!preview && !guide && !failure && (
        <div className="cad-empty-overlay">
          <strong>
            {definitionPresent
              ? 'Exact shape is awaiting rebuild'
              : 'Start with a sketch or a solid'}
          </strong>
          <p>
            {definitionPresent
              ? 'Your definition is saved in feature history. Rebuild in the desktop app to inspect the exact shape.'
              : 'New sketch → choose a plane → draw a closed profile → Finish sketch → Extrude.'}
          </p>
          {!definitionPresent && <p>For an existing part, use Import STEP.</p>}
        </div>
      )}
    </div>
  );
}
