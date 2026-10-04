import DetailDialog from '../../shared/ui/DetailDialog';
import {
  cameraOrientation,
  planeFitDistance,
  boxFitDistance,
  cameraResizeFactor,
  zoomedDistance,
  type CameraView,
} from './camera';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ScanLine, Focus, Ruler, X } from 'lucide-react';
import ViewportTools from './ViewportTools';
import ViewportMenu, { type ViewportMenuContext } from './ViewportMenu';
import { invokeVerification as invoke } from '../../platform/desktop/verification';
import type { Project } from '../../domain/contracts/types';
import {
  deformationScale,
  deformationPhase,
  type Field,
  type ResultData,
  type FieldSource,
} from '../../domain/results/fields';
import { displayValue, formatValue } from '../../domain/units';
import { regionNames, type RegionId } from '../../domain/project/regions';
import { contourColor } from './contours';
import { tractionGlyph } from './traction';
import { surfaceData, type SurfaceData } from './surface';
import {
  pickedRegion,
  nearestHitNode,
  displayedNode,
  visibleTriangles,
  selectedBoundaryBounds,
} from './picking';
import { nextSelection, selectionIntent, contextSelection, type SelectionMode } from './selection';
import { geometryDistance } from './measurement';
import {
  boundaryAnchors,
  boundaryGlyphAnchors,
  supportColor,
  loadColor,
  supportDescription,
  loadDescription,
  loadSummary,
  supportSummary,
} from './boundaryMarkers';

import type { Probe } from '../../domain/results/probe';
type ConditionAnnotation = {
  key: string;
  kind: 'constraint' | 'load';
  id: string;
  name: string;
  region: RegionId;
  point: [number, number, number];
  detail: string;
  summary: string;
  offset: number;
};
type Props = {
  active?: boolean;
  menusBlocked?: boolean;
  locked?: boolean;
  onCondition?: (kind: 'constraint' | 'load', id: string) => void;
  onEditGeometry?: () => void;
  onAddCondition?: (kind: 'constraint' | 'load', regions: RegionId[]) => void;
  onAddNamedSelection?: (regions: RegionId[]) => void;
  project: Project;
  data: ResultData | null;
  field: Field | null;
  selected: RegionId[];
  onSelect: (region: RegionId) => void;
  onSelectionChange?: (regions: RegionId[]) => void;
  selectionMode?: SelectionMode;
  onProbe: (probe: Probe | null) => void;
  onVerified?: (report: Record<string, unknown>) => void;
  edges: boolean;
  deformation: 'off' | 'actual' | 'auto' | 'custom';
  customScale: number;
  source?: FieldSource;
  animate?: boolean;
  theme?: 'light' | 'dark';
};
type Runtime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: THREE.Group;
  surface?: THREE.Mesh;
  grid?: THREE.GridHelper;
  invalidate: () => void;
  fit: (view?: CameraView, regions?: ReadonlySet<RegionId>) => void;
  zoom: (factor: number) => void;
  activate: (active: boolean) => void;
  data?: SurfaceData;
  displayedTriangles: Uint32Array;
  visibleRegions: ReadonlySet<RegionId> | null;
  hover?: { group: THREE.Group; moving: Runtime['moving'] };
  hoverRegion: RegionId | null;
  field?: Field | null;
  scale: number;
  bounds: THREE.Box3;
  viewBounds: THREE.Box3;
  maximumScale: number;
  animationStart: number | null;
  moving: { attribute: THREE.BufferAttribute; nodes: Uint32Array }[];
};
function clearGroup(group: THREE.Group) {
  group.traverse((item) => {
    if (
      item instanceof THREE.Mesh ||
      item instanceof THREE.LineSegments ||
      item instanceof THREE.Line ||
      item instanceof THREE.Points
    ) {
      item.geometry.dispose();
      const materials = Array.isArray(item.material) ? item.material : [item.material];
      materials.forEach((material) => material.dispose());
    }
  });
  group.clear();
}

function regionOverlay(state: Runtime, region: RegionId, color: number) {
  const source = state.data!;
  const nodes: number[] = [];
  if (source.boundaryEdges)
    for (let edge = 0; edge < source.edgeRegions!.length; edge++) {
      if (source.regionIds[source.edgeRegions![edge]] !== region) continue;
      nodes.push(source.boundaryEdges[2 * edge], source.boundaryEdges[2 * edge + 1]);
    }
  else
    for (const triangle of state.displayedTriangles) {
      if (source.regionIds[source.regions[triangle]] !== region) continue;
      nodes.push(...source.triangles.slice(3 * triangle, 3 * triangle + 3));
    }
  const values = new Float32Array(nodes.length * 3);
  nodes.forEach((node, index) =>
    displayedNode(source, node, state.scale).toArray(values, 3 * index),
  );
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(values, 3),
  );
  const overlay = source.boundaryEdges
    ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }))
    : new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          opacity: 0.22,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
  const group = new THREE.Group();
  group.add(overlay);
  return {
    group,
    moving: [
      {
        attribute: geometry.getAttribute('position') as THREE.BufferAttribute,
        nodes: new Uint32Array(nodes),
      },
    ],
  };
}

export default function Viewport(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const labelElements = useRef(new Map<string, HTMLButtonElement>());
  const [annotations, setAnnotations] = useState<ConditionAnnotation[]>([]);
  const annotationPositions = useRef<ConditionAnnotation[]>([]);
  const current = useRef(props);
  current.current = props;
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0);
  const [modelSpan, setModelSpan] = useState<[number, number, number] | null>(null);
  const [hovered, setHovered] = useState<RegionId | null>(null);
  const [isolated, setIsolated] = useState<RegionId[] | null>(null);
  const [cameraView, setCameraView] = useState<CameraView | 'custom'>('isometric');
  const [conditionsShown, setConditionsShown] = useState(true);
  const [contextMenu, setContextMenu] = useState<ViewportMenuContext | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const measurementMode = useRef(measuring);
  measurementMode.current = measuring;
  const [measuredNodes, setMeasuredNodes] = useState<number[]>([]);
  const lastProject = useRef('');
  const initializationError = useRef<string | null>(null);
  const verificationFailureReported = useRef(false);
  const traceVerification = (message: string) => {
    if (current.current.onVerified)
      void invoke('verification_trace', { message }).catch((cause) =>
        console.error('Viewport verification trace failed:', cause),
      );
  };
  const failVerification = (message: string) => {
    if (!current.current.onVerified || verificationFailureReported.current) return;
    verificationFailureReported.current = true;
    void invoke('verification_complete', { report: { error: message } }).catch((cause) =>
      console.error('Viewport verification error report failed:', cause),
    );
  };

  const geometryIdentity = `${props.project.id}:${props.project.study.dimension}:${JSON.stringify(props.project.geometry)}`;
  useEffect(() => {
    setIsolated(null);
    setMeasuredNodes([]);
    setHovered(null);
    setContextMenu(null);
  }, [geometryIdentity, props.data]);

  useEffect(() => {
    const element = container.current!;
    traceVerification('viewport renderer initialization started');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      const message =
        'The 3D viewport requires an available WebGL context. Check your system graphics driver and restart Phyra.';
      initializationError.current = message;
      setError(message);
      failVerification(message);
      return;
    }
    initializationError.current = null;
    traceVerification('viewport renderer initialized');
    // StrictMode can recreate the renderer while retaining component refs.
    lastProject.current = '';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xfafaf8, 1);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.00001, 10000);
    const initialSize = element.getBoundingClientRect();
    let viewportSizeInitialized = initialSize.width > 0 && initialSize.height > 0;
    if (initialSize.width > 0 && initialSize.height > 0) {
      renderer.setSize(initialSize.width, initialSize.height);
      camera.aspect = initialSize.width / initialSize.height;
      camera.updateProjectionMatrix();
    }
    camera.up.set(0, 0, 1);
    let controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.13;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = null;
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 2.3);
    light.position.set(2, -3, 5);
    scene.add(light);
    const model = new THREE.Group();
    scene.add(model);
    let dirty = true;
    let frame = 0;
    const invalidate = () => {
      dirty = true;
    };
    const state: Runtime = {
      renderer,
      scene,
      camera,
      controls,
      model,
      invalidate,
      scale: 0,
      bounds: new THREE.Box3(),
      viewBounds: new THREE.Box3(),
      maximumScale: 0,
      animationStart: null,
      moving: [],
      displayedTriangles: new Uint32Array(),
      visibleRegions: null,
      hoverRegion: null,
      activate: () => {},
      zoom: (factor) => {
        if (current.current.active === false) return;
        const offset = camera.position.clone().sub(controls.target);
        const distance = offset.length();
        if (distance === 0) return;
        camera.position
          .copy(controls.target)
          .addScaledVector(
            offset,
            zoomedDistance(distance, factor, controls.minDistance, controls.maxDistance) / distance,
          );
        controls.update();
        invalidate();
      },
      fit: (view, regions) => {
        if (current.current.active === false) return;
        // Drain any damped orbit/pan before applying an exact named orientation.
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = true;
        const bounds =
          regions && state.data
            ? (selectedBoundaryBounds(state.data, regions, state.maximumScale) ?? state.viewBounds)
            : state.viewBounds;
        const center = bounds.getCenter(new THREE.Vector3());
        const span = bounds.getSize(new THREE.Vector3());
        const size = Math.max(span.length(), 0.000001);
        const plane = current.current.project.study.dimension === '2d';
        const orientation = view ? cameraOrientation(view) : null;
        const direction = orientation
          ? new THREE.Vector3(...orientation.direction)
          : camera.position.clone().sub(controls.target);
        const up = plane
          ? new THREE.Vector3(0, 1, 0)
          : orientation
            ? new THREE.Vector3(...orientation.up)
            : camera.up.clone();
        if (!camera.up.equals(up)) {
          // OrbitControls fixes its up-axis transform at construction. Recreate
          // through its public lifecycle when the named view changes that axis.
          controls.dispose();
          camera.up.copy(up);
          controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.13;
          controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
          controls.mouseButtons.RIGHT = null;
          controls.addEventListener('change', invalidate);
          state.controls = controls;
        }
        controls.enableRotate = !plane;
        controls.mouseButtons.LEFT = plane ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
        if (plane) {
          direction.set(0, 0, 1);
        }
        if (direction.lengthSq() === 0) direction.set(1.3, -1.8, 1.3);
        controls.target.copy(center);
        const distance = plane
          ? planeFitDistance(span.x, span.y, camera.aspect, camera.fov)
          : boxFitDistance(
              [span.x, span.y, span.z],
              [direction.x, direction.y, direction.z],
              [camera.up.x, camera.up.y, camera.up.z],
              camera.aspect,
              camera.fov,
            );
        camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
        camera.near = size / 10000;
        camera.far = Math.max(size * 100, distance * 10);
        camera.updateProjectionMatrix();
        controls.minDistance = size / 10;
        controls.maxDistance = Math.max(size * 30, distance * 5);
        controls.update();
        invalidate();
      },
    };
    runtime.current = state;
    const resizeCanvas = () => {
      if (current.current.active === false) return;
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height);
      const aspect = width / height;
      if (viewportSizeInitialized && state.data) {
        const span = state.viewBounds.getSize(new THREE.Vector3());
        const offset = camera.position.clone().sub(controls.target);
        const factor = cameraResizeFactor(
          [span.x, span.y, span.z],
          [offset.x, offset.y, offset.z],
          [camera.up.x, camera.up.y, camera.up.z],
          camera.aspect,
          aspect,
          camera.fov,
          current.current.project.study.dimension === '2d',
        );
        camera.position.copy(controls.target).addScaledVector(offset, factor);
        const distance = offset.length() * factor;
        camera.far = Math.max(camera.far, distance * 10);
        controls.maxDistance = Math.max(controls.maxDistance, distance * 5);
      }
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      if (!viewportSizeInitialized) {
        viewportSizeInitialized = true;
        if (state.data) state.fit();
      }
      invalidate();
    };
    const resize = new ResizeObserver(resizeCanvas);
    resize.observe(element);
    controls.addEventListener('change', invalidate);
    const fitKey = (event: KeyboardEvent) => {
      if (
        current.current.active !== false &&
        event.key.toLowerCase() === 'f' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.defaultPrevented &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest('[role="dialog"], [role="menu"], [contenteditable="true"]')
        ) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        state.fit(
          undefined,
          event.shiftKey && current.current.selected.length
            ? new Set(current.current.selected)
            : undefined,
        );
      }
    };
    window.addEventListener('keydown', fitKey);
    const animate = (now = performance.now()) => {
      frame = 0;
      if (current.current.active === false) return;
      controls.update();
      if (current.current.animate && state.data?.displacement && state.maximumScale > 0) {
        state.animationStart ??= now;
        state.scale = state.maximumScale * deformationPhase(now - state.animationStart);
        for (const item of [...state.moving, ...(state.hover?.moving ?? [])]) {
          for (let i = 0; i < item.nodes.length; i++)
            for (let axis = 0; axis < 3; axis++)
              item.attribute.array[3 * i + axis] =
                state.data.positions[3 * item.nodes[i] + axis] +
                state.data.displacement[3 * item.nodes[i] + axis] * state.scale;
          item.attribute.needsUpdate = true;
        }
        dirty = true;
      } else state.animationStart = null;
      if (dirty) {
        renderer.render(scene, camera);
        for (const annotation of annotationPositions.current) {
          const label = labelElements.current.get(annotation.key);
          if (!label) continue;
          const point = new THREE.Vector3(...annotation.point).project(camera);
          const visible =
            point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
          label.style.visibility = visible ? 'visible' : 'hidden';
          const x = ((point.x + 1) * element.clientWidth) / 2;
          const y = ((1 - point.y) * element.clientHeight) / 2 + annotation.offset * 40;
          label.style.left = `${Math.max(12, Math.min(x, element.clientWidth - label.offsetWidth - 16))}px`;
          label.style.top = `${Math.max(60, Math.min(y, element.clientHeight - label.offsetHeight - 64))}px`;
        }
        dirty = false;
      }
      frame = requestAnimationFrame(animate);
    };
    state.activate = (active) => {
      controls.enabled = active;
      if (!active) {
        cancelAnimationFrame(frame);
        frame = 0;
        state.animationStart = null;
      } else {
        resizeCanvas();
        invalidate();
        if (!frame) frame = requestAnimationFrame(animate);
      }
    };
    state.activate(current.current.active !== false);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = [0, 0];
    const hitAt = (event: { clientX: number; clientY: number }) => {
      if (!state.surface || !state.data) return null;
      camera.updateMatrixWorld(true);
      if (current.current.animate) state.surface.geometry.computeBoundingSphere();
      const rect = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(state.surface)[0] ?? null;
    };
    const hoverRegion = (region: RegionId | null) => {
      if (region === state.hoverRegion) return;
      if (state.hover) {
        state.model.remove(state.hover.group);
        clearGroup(state.hover.group);
        state.hover = undefined;
      }
      state.hoverRegion = region;
      setHovered(region);
      if (region) {
        state.hover = regionOverlay(state, region, 0xe0b062);
        state.model.add(state.hover.group);
      }
      invalidate();
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0 || measurementMode.current) {
        if (
          current.current.project.study.dimension === '3d' &&
          (event.buttons & 1) !== 0 &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5
        )
          setCameraView('custom');
        hoverRegion(null);
        return;
      }
      const hit = hitAt(event);
      if (!hit || hit.faceIndex == null || !state.data) {
        hoverRegion(null);
        return;
      }
      const triangle = state.displayedTriangles[hit.faceIndex];
      const region = pickedRegion(
        state.data,
        triangle,
        hit.point,
        state.scale,
        {
          camera,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        },
        state.visibleRegions,
      );
      hoverRegion(region === 'Interior' ? null : region);
    };
    const pointerLeave = () => hoverRegion(null);
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
      element.focus({ preventScroll: true });
      hoverRegion(null);
    };
    const openContext = (event: MouseEvent) => {
      event.preventDefault();
      if (current.current.active === false || current.current.menusBlocked) return;
      const hit = hitAt(event);
      const region =
        hit?.faceIndex != null && state.data
          ? pickedRegion(
              state.data,
              state.displayedTriangles[hit.faceIndex],
              hit.point,
              state.scale,
              { camera, width: element.clientWidth, height: element.clientHeight },
              state.visibleRegions,
            )
          : null;
      const boundary = region === 'Interior' ? null : region;
      const regions = contextSelection(current.current.selected, boundary);
      if (boundary && !current.current.selected.includes(boundary)) {
        if (current.current.onSelectionChange) current.current.onSelectionChange(regions);
        else current.current.onSelect(boundary);
      }
      setContextMenu({ x: event.clientX, y: event.clientY, regions, restoreFocus: element });
    };
    const select = (region: RegionId | null, event: PointerEvent) => {
      const currentProps = current.current;
      if (currentProps.onSelectionChange)
        currentProps.onSelectionChange(
          nextSelection(
            currentProps.selected,
            region,
            selectionIntent(event, currentProps.selectionMode ?? 'replace'),
          ),
        );
      else if (region) currentProps.onSelect(region);
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5 ||
        !state.surface ||
        !state.data
      )
        return;
      const hit = hitAt(event);
      if (!hit || hit.faceIndex == null) {
        if (!measurementMode.current) select(null, event);
        current.current.onProbe(null);
        return;
      }
      const triangle = state.displayedTriangles[hit.faceIndex];
      const source = state.data;
      const region = pickedRegion(
        source,
        triangle,
        hit.point,
        state.scale,
        {
          camera,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        },
        state.visibleRegions,
      );
      if (state.visibleRegions && region === 'Interior') {
        current.current.onProbe(null);
        return;
      }
      if (measurementMode.current) {
        const node = nearestHitNode(source, triangle, hit.point, state.scale);
        setMeasuredNodes((previous) => (previous.length === 1 ? [previous[0], node] : [node]));
        return;
      }
      select(region === 'Interior' ? null : region, event);
      if (!state.field) {
        current.current.onProbe(null);
        return;
      }
      let id = source.cells?.[triangle] ?? 0;
      if (state.field.association === 'node') {
        id = nearestHitNode(source, triangle, hit.point, state.scale);
      }
      const position: [number, number, number] =
        state.field.association === 'node'
          ? [source.positions[id * 3], source.positions[id * 3 + 1], source.positions[id * 3 + 2]]
          : [0, 0, 0];
      if (state.field.association === 'cell' && source.volumeCells && source.cellWidth)
        for (let corner = 0; corner < source.cellWidth; corner++)
          for (let axis = 0; axis < 3; axis++)
            position[axis] +=
              source.positions[3 * source.volumeCells[id * source.cellWidth + corner] + axis] /
              source.cellWidth;
      current.current.onProbe({
        association: state.field.association,
        id,
        value: state.field.values[id],
        units: state.field.units,
        position,
        region,
      });
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('contextmenu', openContext);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', fitKey);
      renderer.domElement.removeEventListener('contextmenu', openContext);
      resize.disconnect();
      controls.dispose();
      clearGroup(model);
      state.grid?.geometry.dispose();
      if (state.grid?.material)
        (Array.isArray(state.grid.material) ? state.grid.material : [state.grid.material]).forEach(
          (material) => material.dispose(),
        );
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    runtime.current?.activate(props.active !== false);
    if (props.active === false) setContextMenu(null);
  }, [props.active]);

  useEffect(() => {
    if (props.active === false) return;
    const state = runtime.current;
    if (!state) {
      if (initializationError.current) failVerification(initializationError.current);
      return;
    }
    let data: SurfaceData;
    try {
      data = surfaceData(props.project, props.data, props.source);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Cannot render this mesh.';
      setError(message);
      failVerification(message);
      return;
    }
    setError(null);
    const dark = props.theme === 'dark';
    state.renderer.setClearColor(dark ? 0x202122 : 0xfafaf8, 1);
    clearGroup(state.model);
    state.hover = undefined;
    state.hoverRegion = null;
    setHovered(null);
    state.moving = [];
    state.animationStart = null;
    state.data = data;
    state.field = props.field;
    state.visibleRegions = isolated ? new Set(isolated) : null;
    state.displayedTriangles = visibleTriangles(data, state.visibleRegions);
    const renderNodes = new Uint32Array(state.displayedTriangles.length * 3);
    state.displayedTriangles.forEach((triangle, index) =>
      renderNodes.set(data.triangles.subarray(3 * triangle, 3 * triangle + 3), 3 * index),
    );
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < data.positions.length; i += 3)
      bounds.expandByPoint(
        point.set(data.positions[i], data.positions[i + 1], data.positions[i + 2]),
      );
    state.bounds.copy(bounds);
    setModelSpan(bounds.getSize(new THREE.Vector3()).toArray() as [number, number, number]);
    const length = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-12);
    state.scale = deformationScale(
      data.displacement ?? null,
      length,
      props.deformation,
      props.customScale,
    );
    setScale(state.scale);
    state.maximumScale = state.scale;
    // Camera-only bounds include the undeformed ghost and the full displayed
    // deformation cycle. Physical lengths and scale still use the SI box above.
    state.viewBounds.copy(bounds);
    if (data.displacement && state.maximumScale > 0)
      for (let node = 0; node < data.positions.length / 3; node++)
        state.viewBounds.expandByPoint(displayedNode(data, node, state.maximumScale));
    const positions = new Float32Array(renderNodes.length * 3);
    const colors = new Float32Array(positions.length);
    const undeformed = new Float32Array(positions.length);
    const supportedRegions = new Set<string>(
      props.project.study.constraints.flatMap((item) => item.regions),
    );
    const loadedRegions = new Set<string>(
      props.project.study.loads.flatMap((item) => item.regions),
    );
    const selectedRegions = new Set<string>(props.selected);
    const color = new THREE.Color();
    for (let rendered = 0; rendered < state.displayedTriangles.length; rendered++) {
      const triangle = state.displayedTriangles[rendered];
      const region = data.boundaryEdges ? 'Interior' : data.regionIds[data.regions[triangle]];
      if (!props.field)
        color.set(
          selectedRegions.has(region)
            ? '#ce912c'
            : supportedRegions.has(region)
              ? supportColor
              : loadedRegions.has(region)
                ? loadColor
                : dark
                  ? '#a6aaa8'
                  : '#b2b8b4',
        );
      for (let vertex = 0; vertex < 3; vertex++) {
        const node = data.triangles[triangle * 3 + vertex];
        const offset = (rendered * 3 + vertex) * 3;
        for (let axis = 0; axis < 3; axis++) {
          undeformed[offset + axis] = data.positions[node * 3 + axis];
          positions[offset + axis] =
            data.positions[node * 3 + axis] +
            (data.displacement?.[node * 3 + axis] ?? 0) * state.scale;
        }
        const fieldIndex =
          props.field?.association === 'cell' ? (data.cells?.[triangle] ?? 0) : node;
        if (props.field)
          contourColor(
            props.field.values[fieldIndex],
            props.field.minimum,
            props.field.maximum,
            color,
          );
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    state.moving.push({
      attribute: geometry.getAttribute('position') as THREE.BufferAttribute,
      nodes: renderNodes,
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = props.field
      ? new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
      : new THREE.MeshStandardMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          metalness: 0.14,
          roughness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
    const surface = new THREE.Mesh(geometry, material);
    if (data.boundaryEdges && isolated) {
      material.transparent = true;
      material.opacity = 0.15;
      material.depthWrite = false;
    }
    state.surface = surface;
    state.model.add(surface);
    if ((props.edges || !props.data) && !(data.boundaryEdges && isolated)) {
      let edges: THREE.BufferGeometry;
      if (props.data) {
        const nodes = new Uint32Array(renderNodes.length * 2);
        for (let t = 0; t < renderNodes.length / 3; t++)
          for (let side = 0; side < 3; side++) {
            nodes[t * 6 + side * 2] = renderNodes[t * 3 + side];
            nodes[t * 6 + side * 2 + 1] = renderNodes[t * 3 + ((side + 1) % 3)];
          }
        const values = new Float32Array(nodes.length * 3);
        for (let i = 0; i < nodes.length; i++)
          for (let a = 0; a < 3; a++)
            values[3 * i + a] =
              data.positions[3 * nodes[i] + a] +
              (data.displacement?.[3 * nodes[i] + a] ?? 0) * state.scale;
        edges = new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.BufferAttribute(values, 3),
        );
        state.moving.push({
          attribute: edges.getAttribute('position') as THREE.BufferAttribute,
          nodes,
        });
      } else edges = new THREE.EdgesGeometry(geometry, 24);
      state.model.add(
        new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: dark ? 0x101112 : 0x303633,
            opacity: props.data ? 0.3 : 0.6,
            transparent: true,
          }),
        ),
      );
    }
    if (data.boundaryEdges && data.edgeRegions) {
      for (let edge = 0; edge < data.edgeRegions.length; edge++) {
        const region = data.regionIds[data.edgeRegions[edge]];
        if (state.visibleRegions && !state.visibleRegions.has(region)) continue;
        const nodes = data.boundaryEdges.slice(edge * 2, edge * 2 + 2);
        const values = new Float32Array(6);
        for (let i = 0; i < 2; i++)
          for (let a = 0; a < 3; a++)
            values[3 * i + a] =
              data.positions[3 * nodes[i] + a] +
              (data.displacement?.[3 * nodes[i] + a] ?? 0) * state.scale;
        const line = new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.BufferAttribute(values, 3),
        );
        state.moving.push({
          attribute: line.getAttribute('position') as THREE.BufferAttribute,
          nodes,
        });
        state.model.add(
          new THREE.LineSegments(
            line,
            new THREE.LineBasicMaterial({
              color: selectedRegions.has(region)
                ? '#d79b35'
                : supportedRegions.has(region)
                  ? supportColor
                  : loadedRegions.has(region)
                    ? loadColor
                    : dark
                      ? '#c0c4c1'
                      : '#626965',
              depthTest: false,
            }),
          ),
        );
      }
    }
    if (state.scale > 0 && !(data.boundaryEdges && isolated)) {
      const ghost = new THREE.BufferGeometry();
      ghost.setAttribute('position', new THREE.BufferAttribute(undeformed, 3));
      state.model.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(ghost, 30),
          new THREE.LineBasicMaterial({
            color: dark ? 0xd6d8d3 : 0x4b544f,
            opacity: 0.32,
            transparent: true,
          }),
        ),
      );
      ghost.dispose();
    }
    if (props.selected.length && props.field && !data.boundaryEdges) {
      for (const region of props.selected) {
        if (state.visibleRegions && !state.visibleRegions.has(region)) continue;
        const overlay = regionOverlay(state, region, 0xffffff);
        state.model.add(overlay.group);
        state.moving.push(...overlay.moving);
      }
    }
    // Glyphs and labels use the same boundary facet mapping as selection.
    const nextAnnotations: ConditionAnnotation[] = [];
    const names = regionNames(
      props.project.geometry.kind,
      props.project.study.dimension,
      props.project.geometry.profile,
    );
    const glyphAnchors = conditionsShown ? boundaryGlyphAnchors(data) : new Map();
    for (const anchor of conditionsShown ? boundaryAnchors(data) : []) {
      const region = anchor.region;
      if (state.visibleRegions && !state.visibleRegions.has(region)) continue;
      const center = new THREE.Vector3(...anchor.point);
      const normal = new THREE.Vector3(...anchor.normal);
      const constraints = props.project.study.constraints.filter((item) =>
        item.regions.includes(region),
      );
      const loads = props.project.study.loads.filter((item) => item.regions.includes(region));
      if (constraints.length || loads.length) {
        const overlay = regionOverlay(
          state,
          region,
          new THREE.Color(constraints.length ? supportColor : loadColor).getHex(),
        );
        state.model.add(overlay.group);
        state.moving.push(...overlay.moving);
      }
      let offset = 0;
      const annotate = (
        kind: 'constraint' | 'load',
        item: { id: string; name: string },
        detail: string,
        summary: string,
      ) => {
        nextAnnotations.push({
          key: `${kind}:${item.id}:${region}`,
          kind,
          id: item.id,
          name: item.name,
          region,
          point: anchor.point,
          offset: offset++,
          detail: `${names.find((item) => item.id === region)?.name ?? region} · ${detail}`,
          summary,
        });
      };
      if (constraints.length) {
        for (const item of constraints)
          annotate(
            'constraint',
            item,
            supportDescription(item, props.project.study.dimension),
            supportSummary(item, props.project.study.dimension, props.project.displayUnits),
          );
        const size = length * 0.028;
        if (props.project.study.dimension === '3d') {
          const marker = new THREE.Mesh(
            new THREE.BoxGeometry(size, size, size),
            new THREE.MeshBasicMaterial({ color: supportColor, wireframe: true, depthTest: false }),
          );
          marker.position.copy(center).addScaledVector(normal, size / 2);
          marker.renderOrder = 8;
          state.model.add(marker);
        } else {
          const tangent = new THREE.Vector3(-normal.y, normal.x, 0);
          if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
          tangent.normalize();
          const base = center.clone().addScaledVector(normal, size * 2);
          const left = base.clone().addScaledVector(tangent, size);
          const right = base.clone().addScaledVector(tangent, -size);
          const values = new Float32Array([
            ...center.toArray(),
            ...left.toArray(),
            ...right.toArray(),
            ...center.toArray(),
            ...left.toArray(),
            ...right.toArray(),
          ]);
          const glyph = new THREE.LineSegments(
            new THREE.BufferGeometry().setAttribute(
              'position',
              new THREE.BufferAttribute(values, 3),
            ),
            new THREE.LineBasicMaterial({ color: supportColor, depthTest: false }),
          );
          glyph.renderOrder = 8;
          state.model.add(glyph);
        }
      }
      for (const load of loads) {
        annotate(
          'load',
          load,
          loadDescription(load, props.project.study.dimension),
          loadSummary(load, props.project.study.dimension, anchor),
        );
        for (const glyphAnchor of load.kind === 'force'
          ? [anchor]
          : (glyphAnchors.get(region) ?? [anchor])) {
          const glyphCenter = new THREE.Vector3(...glyphAnchor.point);
          const glyphNormal = new THREE.Vector3(...glyphAnchor.normal);
          const traction =
            load.kind === 'traction'
              ? tractionGlyph(
                  load.traction,
                  glyphCenter.x,
                  glyphCenter.y,
                  glyphNormal.x,
                  glyphNormal.y,
                )
              : null;
          const direction =
            load.kind === 'pressure'
              ? glyphNormal.clone().multiplyScalar(-Math.sign(load.pressure))
              : load.kind === 'traction'
                ? new THREE.Vector3(...(traction ?? [0, 0]), 0).normalize()
                : new THREE.Vector3(...load.vector).normalize();
          if (direction.lengthSq() === 0) continue;
          const arrow = new THREE.ArrowHelper(
            direction,
            glyphCenter.clone().addScaledVector(direction, -length * 0.09),
            length * 0.09,
            new THREE.Color(loadColor).getHex(),
            length * 0.023,
            length * 0.013,
          );
          for (const mesh of [arrow.line, arrow.cone])
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
              material.depthTest = false;
          arrow.renderOrder = 8;
          state.model.add(arrow);
          state.viewBounds.expandByPoint(arrow.position).expandByPoint(glyphCenter);
        }
      }
    }
    annotationPositions.current = nextAnnotations;
    setAnnotations(nextAnnotations);
    if (
      measuredNodes.length &&
      measuredNodes.every((node) => node * 3 + 2 < data.positions.length)
    ) {
      const values = new Float32Array(measuredNodes.length * 3);
      measuredNodes.forEach((node, index) =>
        displayedNode(data, node, state.scale).toArray(values, 3 * index),
      );
      const measurementGeometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(values, 3),
      );
      const points = new THREE.Points(
        measurementGeometry,
        new THREE.PointsMaterial({
          color: 0xe0b062,
          size: 7,
          sizeAttenuation: false,
          depthTest: false,
        }),
      );
      points.renderOrder = 10;
      state.model.add(points);
      state.moving.push({
        attribute: measurementGeometry.getAttribute('position') as THREE.BufferAttribute,
        nodes: new Uint32Array(measuredNodes),
      });
      if (measuredNodes.length === 2) {
        const lineGeometry = measurementGeometry.clone();
        const line = new THREE.Line(
          lineGeometry,
          new THREE.LineBasicMaterial({ color: 0xe0b062, depthTest: false }),
        );
        line.renderOrder = 10;
        state.model.add(line);
        state.moving.push({
          attribute: lineGeometry.getAttribute('position') as THREE.BufferAttribute,
          nodes: new Uint32Array(measuredNodes),
        });
      }
    }
    if (state.grid) {
      state.scene.remove(state.grid);
      state.grid.geometry.dispose();
      (Array.isArray(state.grid.material) ? state.grid.material : [state.grid.material]).forEach(
        (material) => material.dispose(),
      );
    }
    const grid = new THREE.GridHelper(
      length * 4,
      24,
      dark ? 0x393c3b : 0xd6dad6,
      dark ? 0x2b2e2d : 0xe9ebe7,
    );
    grid.rotation.x = Math.PI / 2;
    grid.position.set(
      bounds.getCenter(new THREE.Vector3()).x,
      bounds.getCenter(new THREE.Vector3()).y,
      bounds.min.z - length * 0.04,
    );
    state.grid = grid;
    state.scene.add(grid);
    if (lastProject.current !== `${props.project.id}-${props.project.study.dimension}`) {
      const view = props.project.study.dimension === '2d' ? 'top' : 'isometric';
      state.fit(view);
      setCameraView(view);
      lastProject.current = `${props.project.id}-${props.project.study.dimension}`;
    }
    state.invalidate();
    let verificationDone = false;
    if (props.onVerified && props.field && props.data && props.data.manifest.operation !== 'mesh') {
      const verify = () => {
        if (
          verificationDone ||
          runtime.current !== state ||
          !current.current.onVerified ||
          current.current.data !== props.data ||
          current.current.field !== props.field
        )
          return;
        verificationDone = true;
        traceVerification('viewport verification render');
        try {
          state.renderer.render(state.scene, state.camera);
          surface.updateMatrixWorld(true);
          const center = bounds.getCenter(new THREE.Vector3());
          const plane = props.project.study.dimension === '2d';
          const target = center.clone();
          if (plane && data.boundaryEdges && data.edgeRegions) {
            const x1 = data.regionIds.indexOf('x1');
            const edges = Array.from(data.edgeRegions.keys()).filter(
              (edge) => data.edgeRegions![edge] === x1,
            );
            const edge = edges[Math.floor(edges.length / 2)];
            if (edge !== undefined) {
              const a = data.boundaryEdges[edge * 2];
              const b = data.boundaryEdges[edge * 2 + 1];
              target.copy(displayedNode(data, a, state.scale));
              target.add(displayedNode(data, b, state.scale)).multiplyScalar(0.5);
              // Move slightly into the adjacent triangle so the ray has an unambiguous hit.
              for (let cell = 0; cell < data.triangles.length / 3; cell++) {
                const nodes = Array.from(data.triangles.slice(cell * 3, cell * 3 + 3));
                if (nodes.includes(a) && nodes.includes(b)) {
                  const centroid = nodes
                    .map((node) => displayedNode(data, node, state.scale))
                    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
                    .multiplyScalar(1 / 3);
                  target.lerp(centroid, 1e-5);
                  break;
                }
              }
            }
          }
          const ray = new THREE.Raycaster(
            target
              .clone()
              .add(
                plane ? new THREE.Vector3(0, 0, length * 3) : new THREE.Vector3(length * 3, 0, 0),
              ),
            plane ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0),
          );
          const hit = ray.intersectObject(surface)[0];
          const triangle = hit?.faceIndex != null ? state.displayedTriangles[hit.faceIndex] : -1;
          const node = triangle >= 0 ? data.triangles[triangle * 3] : -1;
          const index = props.field!.association === 'cell' ? (data.cells?.[triangle] ?? -1) : node;
          const drawingBuffer = [state.renderer.domElement.width, state.renderer.domElement.height];
          let viewportPng = state.renderer.domElement.toDataURL('image/png');
          // The explicit verification run captures the actual rendered scene; cap its
          // IPC size without changing the normal high-DPI display configuration.
          if (viewportPng.length > 700000) {
            const pixelRatio = state.renderer.getPixelRatio();
            state.renderer.setPixelRatio(1);
            state.renderer.render(state.scene, state.camera);
            viewportPng = state.renderer.domElement.toDataURL('image/png');
            state.renderer.setPixelRatio(pixelRatio);
            state.renderer.render(state.scene, state.camera);
          }
          traceVerification('viewport verification report');
          current.current.onVerified!({
            renderedTriangles: state.displayedTriangles.length,
            field: props.field!.label,
            association: props.field!.association,
            pickedRegion:
              triangle >= 0 && hit
                ? pickedRegion(data, triangle, hit.point, state.scale, {
                    camera: state.camera,
                    width: container.current!.clientWidth,
                    height: container.current!.clientHeight,
                  })
                : null,
            probedIndex: index,
            probedValue: index >= 0 ? props.field!.values[index] : null,
            fieldMinimum: props.field!.minimum,
            fieldMaximum: props.field!.maximum,
            deformationScale: state.scale,
            drawingBuffer,
            viewportPng: viewportPng.length <= 900000 ? viewportPng : null,
            webgl: state.renderer.capabilities.isWebGL2 ? 2 : 1,
          });
        } catch (cause) {
          failVerification(
            cause instanceof Error ? cause.message : 'Viewport verification rendering failed.',
          );
        }
      };
      // Scene setup is complete. Verify its actual render synchronously because
      // native background/locked windows can suspend both timers and rAF.
      traceVerification('viewport verification ready');
      verify();
    }
    return () => {
      verificationDone = true;
    };
  }, [
    props.active,
    props.project,
    props.data,
    props.field,
    props.selected,
    props.edges,
    props.deformation,
    props.customScale,
    props.source,
    props.animate,
    props.theme,
    conditionsShown,
    isolated,
    measuredNodes,
    !!props.onVerified,
  ]);

  const distance =
    measuredNodes.length === 2 &&
    runtime.current?.data &&
    measuredNodes.every(
      (node) => node >= 0 && node * 3 + 2 < runtime.current!.data!.positions.length,
    )
      ? displayValue(
          geometryDistance(runtime.current.data.positions, measuredNodes[0], measuredNodes[1]),
          'm',
          props.project.displayUnits,
        )
      : null;
  const supportSymbol = props.project.study.dimension === '2d' ? '△' : '▣';
  const boundaryNames = regionNames(
    props.project.geometry.kind,
    props.project.study.dimension,
    props.project.geometry.profile,
  );
  const regionLabel = hovered
    ? (regionNames(
        props.project.geometry.kind,
        props.project.study.dimension,
        props.project.geometry.profile,
      ).find((region) => region.id === hovered)?.name ?? hovered)
    : null;
  const resetView = () => {
    const view = props.project.study.dimension === '2d' ? 'top' : 'isometric';
    setCameraView(view);
    runtime.current?.fit(view);
  };
  const isolateSelection = (regions: RegionId[]) => {
    setIsolated([...regions]);
    setMeasuredNodes([]);
    props.onProbe(null);
  };
  const openModelActions = (element: HTMLElement) => {
    if (props.active === false || props.menusBlocked) return;
    const bounds = element.getBoundingClientRect();
    setContextMenu({
      x: bounds.left,
      y: bounds.bottom + 4,
      regions: [...props.selected],
      restoreFocus: element,
    });
  };
  return (
    <div className="viewport">
      <div
        ref={container}
        className="viewport-canvas"
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
            event.preventDefault();
            if (props.active === false || props.menusBlocked) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            setContextMenu({
              x: bounds.left + bounds.width / 2,
              y: bounds.top + bounds.height / 2,
              regions: [...props.selected],
              restoreFocus: event.currentTarget,
            });
          } else if (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            ['+', '=', '-', '_'].includes(event.key)
          ) {
            event.preventDefault();
            runtime.current?.zoom(event.key === '+' || event.key === '=' ? 0.8 : 1.25);
          } else if (event.key === 'Escape') {
            setMeasuring(false);
            setMeasuredNodes([]);
            props.onSelectionChange?.([]);
          }
        }}
        aria-label={
          props.project.study.dimension === '2d'
            ? 'Interactive plane stress model. Drag to pan, scroll or plus and minus to zoom, click edges to select, right-click or Shift+F10 for actions.'
            : 'Interactive 3D model. Drag to orbit, Shift-drag to pan, scroll or plus and minus to zoom, click boundaries to select, right-click or Shift+F10 for actions.'
        }
      />
      <div className="viewport-condition-markers" aria-label="Located supports and loads">
        {annotations.map((annotation) => (
          <button
            key={annotation.key}
            ref={(element) => {
              if (element) labelElements.current.set(annotation.key, element);
              else labelElements.current.delete(annotation.key);
            }}
            className={`viewport-condition-marker ${annotation.kind}`}
            title={`${annotation.name} · ${annotation.detail}. Click to edit.`}
            aria-label={`${annotation.kind === 'constraint' ? 'Support' : 'Load'} ${annotation.name} on ${annotation.detail}`}
            onClick={() => {
              props.onSelectionChange?.([annotation.region]);
              if (!props.onSelectionChange) props.onSelect(annotation.region);
              props.onCondition?.(annotation.kind, annotation.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (props.active === false || props.menusBlocked) return;
              const regions = contextSelection(props.selected, annotation.region);
              if (props.onSelectionChange) props.onSelectionChange(regions);
              else props.onSelect(annotation.region);
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                regions,
                restoreFocus: event.currentTarget,
              });
            }}
          >
            <span aria-hidden="true">{annotation.kind === 'constraint' ? supportSymbol : '↗'}</span>
            <span className="viewport-condition-copy">
              <strong>{annotation.name}</strong>
              <small>{annotation.summary}</small>
            </span>
          </button>
        ))}
      </div>
      {conditionsShown &&
        (props.project.study.constraints.length > 0 || props.project.study.loads.length > 0) && (
          <DetailDialog
            className="viewport-condition-legend"
            title={
              <>
                <span className="support-key">{supportSymbol} Supports</span>
                <span className="load-key">↗ Loads</span>
              </>
            }
          >
            <div className="viewport-condition-list">
              <p>
                Symbols mark undeformed boundaries. Arrows show direction; lengths are schematic.
              </p>
              {[
                ...props.project.study.constraints.map((item) => ({
                  item,
                  kind: 'constraint' as const,
                  detail: supportDescription(item, props.project.study.dimension),
                })),
                ...props.project.study.loads.map((item) => ({
                  item,
                  kind: 'load' as const,
                  detail: loadDescription(item, props.project.study.dimension),
                })),
              ].map(({ item, kind, detail }) => (
                <button
                  key={`${kind}:${item.id}`}
                  data-detail-close
                  onClick={() => {
                    props.onSelectionChange?.(item.regions);
                    if (!props.onSelectionChange && item.regions[0])
                      props.onSelect(item.regions[0]);
                    props.onCondition?.(kind, item.id);
                  }}
                >
                  <strong className={kind === 'constraint' ? 'support-key' : 'load-key'}>
                    {kind === 'constraint' ? supportSymbol : '↗'} {item.name}
                  </strong>
                  <span>
                    {item.regions
                      .map(
                        (id) =>
                          boundaryNames.find((region) => region.id === id)?.name ??
                          `${id} (missing)`,
                      )
                      .join(', ') || 'No boundary assigned'}
                  </span>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
          </DetailDialog>
        )}
      {error && <div className="viewport-error">{error}</div>}
      <ViewportTools
        dimension={props.project.study.dimension}
        view={cameraView}
        selectionCount={props.selected.length}
        isolated={isolated !== null}
        measuring={measuring}
        conditionsShown={conditionsShown}
        onView={(view) => {
          setCameraView(view);
          runtime.current?.fit(view);
        }}
        onFit={() => runtime.current?.fit()}
        onFitSelection={() => runtime.current?.fit(undefined, new Set(props.selected))}
        onZoom={(factor) => runtime.current?.zoom(factor)}
        onReset={resetView}
        onIsolate={() => isolateSelection(props.selected)}
        onRestore={() => setIsolated(null)}
        onMeasure={() => {
          setMeasuring(!measuring);
          setMeasuredNodes([]);
        }}
        onConditions={() => setConditionsShown(!conditionsShown)}
        onActions={openModelActions}
      />
      {contextMenu && (
        <ViewportMenu
          context={contextMenu}
          label={
            contextMenu.regions.length === 1
              ? (boundaryNames.find((item) => item.id === contextMenu.regions[0])?.name ??
                'Boundary actions')
              : contextMenu.regions.length
                ? `${contextMenu.regions.length} selected boundaries`
                : 'Model actions · select a boundary to assign conditions'
          }
          project={props.project}
          available={props.active !== false && !props.menusBlocked}
          locked={props.locked}
          isolated={isolated !== null}
          onEditGeometry={props.onEditGeometry}
          onAddCondition={props.onAddCondition}
          onAddNamedSelection={props.onAddNamedSelection}
          onCondition={props.onCondition}
          onFitSelection={(regions) => runtime.current?.fit(undefined, new Set(regions))}
          onIsolate={isolateSelection}
          onRestore={() => setIsolated(null)}
          onFit={() => runtime.current?.fit()}
          onReset={resetView}
          onClearSelection={
            props.onSelectionChange ? () => props.onSelectionChange?.([]) : undefined
          }
          onClose={() => setContextMenu(null)}
        />
      )}
      <div className="viewport-caption">
        <ScanLine size={13} />
        <span>
          {props.data
            ? props.project.study.dimension === '2d'
              ? 'Plane stress · triangle mesh'
              : 'Volume mesh · surface view'
            : 'Geometry preview'}
          {props.field
            ? ` · ${props.field.association === 'cell' ? 'Element values, flat contours' : 'Nodal values'}`
            : ''}
        </span>
      </div>
      {isolated && (
        <div className="viewport-isolation" role="status">
          <Focus size={12} /> {isolated.length}{' '}
          {props.project.study.dimension === '2d' ? 'edge' : 'boundary'}
          {isolated.length === 1 ? '' : 's'} isolated
          <button aria-label="Exit boundary isolation" onClick={() => setIsolated(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {regionLabel && !measuring && (
        <div className="viewport-hover" role="status">
          <strong>{regionLabel}</strong> <code>{hovered}</code>
          <span>
            {props.project.study.constraints
              .filter((item) => item.regions.includes(hovered!))
              .map((item) => `${supportSymbol} ${item.name}`)
              .concat(
                props.project.study.loads
                  .filter((item) => item.regions.includes(hovered!))
                  .map((item) => `↗ ${item.name}`),
              )
              .join(' · ') || 'Unassigned boundary'}
          </span>
        </div>
      )}
      {props.selected.length > 0 && !measuring && (
        <div className="viewport-selection-label" role="status">
          Selected:{' '}
          {props.selected
            .map((id) => boundaryNames.find((region) => region.id === id)?.name ?? id)
            .join(', ')}
        </div>
      )}
      {(measuring || measuredNodes.length > 0) && (
        <div className="viewport-measurement" role="status">
          <Ruler size={13} />
          <span>
            <strong>
              {distance
                ? `${formatValue(distance.value)} ${distance.units}`
                : measuredNodes.length === 1
                  ? 'Select the second node'
                  : props.data
                    ? 'Select two mesh nodes'
                    : 'Select two geometry vertices'}
            </strong>
            <small>
              Undeformed distance · snaps to {props.data ? 'mesh nodes' : 'vertices'}
              {distance ? ' · click to start again' : ''}
            </small>
          </span>
          <button
            aria-label="Close measurement"
            onClick={() => {
              setMeasuring(false);
              setMeasuredNodes([]);
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {props.data && props.data.manifest.operation !== 'mesh' && (
        <div className="deformation-badge">
          {props.animate ? 'Peak deformation' : 'Deformation'} × {formatValue(scale)}
          {scale === 0 ? ' · undeformed' : scale === 1 ? ' · actual scale' : ' · amplified'}
          {props.animate ? ' · static deformation cycle' : ''}
        </div>
      )}
      <div className="axis-key">
        <span className="axis-x">X</span>
        <span className="axis-y">Y</span>
        {props.project.study.dimension !== '2d' && <span className="axis-z">Z</span>}
        <small>Global axes</small>
        {modelSpan && (
          <small className="viewport-model-size">
            {modelSpan
              .slice(0, props.project.study.dimension === '2d' ? 2 : 3)
              .map((value) =>
                formatValue(displayValue(value, 'm', props.project.displayUnits).value),
              )
              .join(' × ')}{' '}
            {props.project.displayUnits}
          </small>
        )}
      </div>
      <div className="viewport-help">
        {props.project.study.dimension === '2d'
          ? 'Drag to pan'
          : 'Drag to orbit · Shift-drag to pan'}{' '}
        <i /> Scroll to zoom <i />{' '}
        {measuring
          ? 'Click to snap measurement nodes'
          : props.project.study.dimension === '2d'
            ? 'Click edges · Shift add · Ctrl/⌘ toggle'
            : 'Click faces · Shift add · Ctrl/⌘ toggle'}
        <i /> Right-click for actions
      </div>
    </div>
  );
}
