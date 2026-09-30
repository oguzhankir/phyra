import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize, RotateCcw, ScanLine } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from './types';
import {
  deformationScale,
  deformationPhase,
  formatValue,
  numericArray,
  solutionArray,
  normalizedValue,
  regionNames,
  type Field,
  type RegionId,
  type ResultData,
  type FieldSource,
} from './fields';

export type Probe = {
  association: 'node' | 'cell';
  id: number;
  value: number;
  units: string;
  position: [number, number, number];
  region: string;
};
type Props = {
  project: Project;
  data: ResultData | null;
  field: Field | null;
  selected: RegionId[];
  onSelect: (region: RegionId) => void;
  onProbe: (probe: Probe | null) => void;
  onVerified?: (report: Record<string, unknown>) => void;
  edges: boolean;
  deformation: 'off' | 'actual' | 'auto' | 'custom';
  customScale: number;
  source?: FieldSource;
  animate?: boolean;
};
type SurfaceData = {
  positions: Float64Array;
  triangles: Uint32Array;
  regions: Uint32Array;
  regionIds: RegionId[];
  cells?: Uint32Array;
  volumeCells?: Uint32Array;
  cellWidth?: number;
  displacement?: Float64Array;
  boundaryEdges?: Uint32Array;
  edgeRegions?: Uint32Array;
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
  fit: () => void;
  data?: SurfaceData;
  field?: Field | null;
  scale: number;
  bounds: THREE.Box3;
  maximumScale: number;
  animationStart: number | null;
  moving: { attribute: THREE.BufferAttribute; nodes: Uint32Array }[];
};
const palette = [
  new THREE.Color('#287fc3'),
  new THREE.Color('#36ced4'),
  new THREE.Color('#b1d889'),
  new THREE.Color('#f4cd60'),
  new THREE.Color('#f5774f'),
];
function contourColor(
  value: number,
  minimum: number,
  maximum: number,
  target: THREE.Color,
): THREE.Color {
  const t = normalizedValue(value, minimum, maximum) * (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.floor(t));
  return target.copy(palette[index]).lerp(palette[index + 1], t - index);
}
function primitiveSurface(project: Project): SurfaceData {
  const { kind, length: l, width: w, height: h, radius: r, thickness: t } = project.geometry;
  const regionIds = regionNames(kind, project.study.dimension).map((region) => region.id);
  if (project.study.dimension === '2d')
    return {
      positions: new Float64Array([0, 0, 0, l, 0, 0, l, w, 0, 0, w, 0]),
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      regions: new Uint32Array(2),
      regionIds,
      boundaryEdges: new Uint32Array([3, 0, 1, 2, 0, 1, 2, 3]),
      edgeRegions: new Uint32Array([0, 1, 2, 3]),
    };
  const vertices: number[] = [];
  const triangles: number[] = [];
  const regions: number[] = [];
  const triangle = (a: number[], b: number[], c: number[], region: RegionId) => {
    const start = vertices.length / 3;
    vertices.push(...a, ...b, ...c);
    triangles.push(start, start + 1, start + 2);
    regions.push(regionIds.indexOf(region));
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], region: RegionId) => {
    triangle(a, b, c, region);
    triangle(a, c, d, region);
  };
  if (kind === 'cylinder') {
    for (let i = 0; i < 72; i++) {
      const a = (2 * Math.PI * i) / 72;
      const b = (2 * Math.PI * (i + 1)) / 72;
      const a0 = [0, r * Math.cos(a), r * Math.sin(a)];
      const b0 = [0, r * Math.cos(b), r * Math.sin(b)];
      const a1 = [l, a0[1], a0[2]];
      const b1 = [l, b0[1], b0[2]];
      triangle([0, 0, 0], b0, a0, 'x0');
      triangle([l, 0, 0], a1, b1, 'x1');
      quad(a0, b0, b1, a1, 'outer');
    }
  } else {
    const outline =
      kind === 'bracket'
        ? [
            [0, 0],
            [l, 0],
            [l, t],
            [t, t],
            [t, w],
            [0, w],
          ]
        : [
            [0, 0],
            [l, 0],
            [l, w],
            [0, w],
          ];
    const sides: RegionId[] =
      kind === 'bracket'
        ? ['y0', 'x1', 'inner-y', 'inner-x', 'y1', 'x0']
        : ['y0', 'x1', 'y1', 'x0'];
    const top = outline.map(([x, y]) => [x, y, h]);
    const bottom = outline.map(([x, y]) => [x, y, 0]);
    const faces = THREE.ShapeUtils.triangulateShape(
      outline.map(([x, y]) => new THREE.Vector2(x, y)),
      [],
    );
    for (const [a, b, c] of faces) {
      triangle(bottom[c], bottom[b], bottom[a], 'z0');
      triangle(top[a], top[b], top[c], 'z1');
    }
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      quad(bottom[i], bottom[next], top[next], top[i], sides[i]);
    }
  }
  return {
    positions: new Float64Array(vertices),
    triangles: new Uint32Array(triangles),
    regions: new Uint32Array(regions),
    regionIds,
  };
}
function surfaceData(
  project: Project,
  data: ResultData | null,
  source: FieldSource = 'primary',
): SurfaceData {
  if (!data) return primitiveSurface(project);
  return {
    positions: numericArray(data, 'positions') as Float64Array,
    triangles: numericArray(data, 'surface') as Uint32Array,
    regions: numericArray(data, 'surfaceRegions') as Uint32Array,
    regionIds: data.manifest.regions.map((region) => region.id as RegionId),
    cells: numericArray(data, 'surfaceCells') as Uint32Array,
    volumeCells: numericArray(data, 'cells') as Uint32Array,
    cellWidth: data.manifest.arrays.cells.shape[1],
    displacement:
      data.manifest.operation !== 'mesh' ? solutionArray(data, 'displacement', source) : undefined,
    boundaryEdges:
      data.manifest.dimension === '2d'
        ? (numericArray(data, 'boundaryEdges') as Uint32Array)
        : undefined,
    edgeRegions:
      data.manifest.dimension === '2d'
        ? (numericArray(data, 'edgeRegions') as Uint32Array)
        : undefined,
  };
}
function pickedRegion(
  source: SurfaceData,
  triangle: number,
  point: THREE.Vector3,
  scale: number,
  length: number,
): string {
  let region: string = source.regionIds[source.regions[triangle]];
  if (source.boundaryEdges) {
    let distance = Infinity;
    let nearest = -1;
    const line = new THREE.Line3();
    for (let edge = 0; edge < source.boundaryEdges.length / 2; edge++) {
      for (const [endpoint, node] of [
        [line.start, source.boundaryEdges[2 * edge]],
        [line.end, source.boundaryEdges[2 * edge + 1]],
      ] as const)
        endpoint
          .fromArray(source.positions, 3 * node)
          .add(
            new THREE.Vector3()
              .fromArray(
                source.displacement ?? new Float64Array(3),
                source.displacement ? 3 * node : 0,
              )
              .multiplyScalar(scale),
          );
      const candidate = line
        .closestPointToPoint(point, true, new THREE.Vector3())
        .distanceToSquared(point);
      if (candidate < distance) {
        distance = candidate;
        nearest = edge;
      }
    }
    region =
      distance < Math.pow(length * 0.035, 2)
        ? source.regionIds[source.edgeRegions![nearest]]
        : 'Interior';
  }
  return region;
}

function clearGroup(group: THREE.Group) {
  group.traverse((item) => {
    if (
      item instanceof THREE.Mesh ||
      item instanceof THREE.LineSegments ||
      item instanceof THREE.Line
    ) {
      item.geometry.dispose();
      const materials = Array.isArray(item.material) ? item.material : [item.material];
      materials.forEach((material) => material.dispose());
    }
  });
  group.clear();
}

export default function Viewport(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const current = useRef(props);
  current.current = props;
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0);
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

  useEffect(() => {
    const element = container.current!;
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
    // StrictMode can recreate the renderer while retaining component refs.
    lastProject.current = '';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x15191f, 1);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.00001, 10000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.13;
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const light = new THREE.DirectionalLight(0xddeeff, 2.6);
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
      maximumScale: 0,
      animationStart: null,
      moving: [],
      fit: () => {
        const bounds = state.bounds;
        const center = bounds.getCenter(new THREE.Vector3());
        const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 0.000001);
        controls.target.copy(center);
        const plane = current.current.project.study.dimension === '2d';
        controls.enableRotate = !plane;
        controls.mouseButtons.LEFT = plane ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
        camera.up.set(0, plane ? 1 : 0, plane ? 0 : 1);
        camera.position
          .copy(center)
          .add(
            (plane ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1.3, -1.8, 1.3))
              .normalize()
              .multiplyScalar(size * 1.7),
          );
        camera.near = size / 10000;
        camera.far = size * 100;
        camera.updateProjectionMatrix();
        controls.minDistance = size / 10;
        controls.maxDistance = size * 30;
        controls.update();
        invalidate();
      },
    };
    runtime.current = state;
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    });
    resize.observe(element);
    controls.addEventListener('change', invalidate);
    const fitKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 'f' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      )
        state.fit();
    };
    window.addEventListener('keydown', fitKey);
    const animate = (now = performance.now()) => {
      controls.update();
      if (current.current.animate && state.data?.displacement && state.maximumScale > 0) {
        state.animationStart ??= now;
        state.scale = state.maximumScale * deformationPhase(now - state.animationStart);
        for (const item of state.moving) {
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
        dirty = false;
      }
      frame = requestAnimationFrame(animate);
    };
    animate();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = [0, 0];
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5 ||
        !state.surface ||
        !state.data
      )
        return;
      const rect = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(state.surface)[0];
      if (!hit || hit.faceIndex == null) {
        current.current.onProbe(null);
        return;
      }
      const triangle = hit.faceIndex;
      const source = state.data;
      const region = pickedRegion(
        source,
        triangle,
        hit.point,
        state.scale,
        state.bounds.getSize(new THREE.Vector3()).length(),
      );
      if (region !== 'Interior') current.current.onSelect(region as RegionId);
      if (!state.field) {
        current.current.onProbe(null);
        return;
      }
      let id = source.cells?.[triangle] ?? 0;
      if (state.field.association === 'node') {
        const nodes = [
          source.triangles[triangle * 3],
          source.triangles[triangle * 3 + 1],
          source.triangles[triangle * 3 + 2],
        ];
        let distance = Infinity;
        for (const node of nodes) {
          const position = new THREE.Vector3(
            source.positions[node * 3],
            source.positions[node * 3 + 1],
            source.positions[node * 3 + 2],
          );
          if (source.displacement)
            position.add(
              new THREE.Vector3(
                source.displacement[node * 3],
                source.displacement[node * 3 + 1],
                source.displacement[node * 3 + 2],
              ).multiplyScalar(state.scale),
            );
          const candidate = position.distanceToSquared(hit.point);
          if (candidate < distance) {
            distance = candidate;
            id = node;
          }
        }
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
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', fitKey);
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
    clearGroup(state.model);
    state.moving = [];
    state.animationStart = null;
    state.data = data;
    state.field = props.field;
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < data.positions.length; i += 3)
      bounds.expandByPoint(
        point.set(data.positions[i], data.positions[i + 1], data.positions[i + 2]),
      );
    state.bounds.copy(bounds);
    const length = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-12);
    state.scale = deformationScale(
      data.displacement ?? null,
      length,
      props.deformation,
      props.customScale,
    );
    setScale(state.scale);
    state.maximumScale = state.scale;
    const positions = new Float32Array(data.triangles.length * 3);
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
    for (let triangle = 0; triangle < data.triangles.length / 3; triangle++) {
      const region = data.boundaryEdges ? 'Interior' : data.regionIds[data.regions[triangle]];
      if (!props.field)
        color.set(
          selectedRegions.has(region)
            ? '#60d4e2'
            : supportedRegions.has(region)
              ? '#519a91'
              : loadedRegions.has(region)
                ? '#b68c61'
                : '#73929d',
        );
      for (let vertex = 0; vertex < 3; vertex++) {
        const node = data.triangles[triangle * 3 + vertex];
        const offset = (triangle * 3 + vertex) * 3;
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
      nodes: data.triangles,
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      metalness: 0.14,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const surface = new THREE.Mesh(geometry, material);
    state.surface = surface;
    state.model.add(surface);
    if (props.edges || !props.data) {
      let edges: THREE.BufferGeometry;
      if (props.data) {
        const nodes = new Uint32Array(data.triangles.length * 2);
        for (let t = 0; t < data.triangles.length / 3; t++)
          for (let side = 0; side < 3; side++) {
            nodes[t * 6 + side * 2] = data.triangles[t * 3 + side];
            nodes[t * 6 + side * 2 + 1] = data.triangles[t * 3 + ((side + 1) % 3)];
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
            color: 0x06121d,
            opacity: props.data ? 0.36 : 0.65,
            transparent: true,
          }),
        ),
      );
    }
    if (data.boundaryEdges && data.edgeRegions) {
      for (let edge = 0; edge < data.edgeRegions.length; edge++) {
        const region = data.regionIds[data.edgeRegions[edge]];
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
                ? '#ffffff'
                : supportedRegions.has(region)
                  ? '#70d6b5'
                  : loadedRegions.has(region)
                    ? '#f5ac66'
                    : '#8296a7',
              depthTest: false,
            }),
          ),
        );
      }
    }
    if (state.scale > 0) {
      const ghost = new THREE.BufferGeometry();
      ghost.setAttribute('position', new THREE.BufferAttribute(undeformed, 3));
      state.model.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(ghost, 30),
          new THREE.LineBasicMaterial({ color: 0xc8d5de, opacity: 0.24, transparent: true }),
        ),
      );
      ghost.dispose();
    }
    if (props.selected.length && props.field && !data.boundaryEdges) {
      const selectedVertices: number[] = [];
      for (let i = 0; i < data.regions.length; i++)
        if (props.selected.includes(data.regionIds[data.regions[i]]))
          selectedVertices.push(...positions.slice(i * 9, i * 9 + 9));
      const selectedGeometry = new THREE.BufferGeometry();
      selectedGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(selectedVertices, 3),
      );
      state.model.add(
        new THREE.Mesh(
          selectedGeometry,
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            opacity: 0.18,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        ),
      );
    }
    // Region markings come from the same authoritative boundary mapping used for picking.
    for (const region of data.regionIds) {
      const index = data.regionIds.indexOf(region);
      const triangle = data.regions.findIndex((candidate) => candidate === index);
      const boundary = data.edgeRegions?.findIndex((candidate) => candidate === index) ?? -1;
      if (triangle < 0 && boundary < 0) continue;
      const ids =
        data.boundaryEdges && boundary >= 0
          ? Array.from(data.boundaryEdges.slice(boundary * 2, boundary * 2 + 2))
          : [
              data.triangles[triangle * 3],
              data.triangles[triangle * 3 + 1],
              data.triangles[triangle * 3 + 2],
            ];
      const points = ids.map(
        (node) =>
          new THREE.Vector3(
            data.positions[node * 3],
            data.positions[node * 3 + 1],
            data.positions[node * 3 + 2],
          ),
      );
      const center = points
        .reduce((sum, value) => sum.add(value), new THREE.Vector3())
        .multiplyScalar(1 / points.length);
      const normal = data.boundaryEdges
        ? new THREE.Vector3(points[1].y - points[0].y, points[0].x - points[1].x, 0).normalize()
        : points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      if (props.project.study.constraints.some((item) => item.regions.includes(region))) {
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(length * 0.022, length * 0.022, length * 0.022),
          new THREE.MeshBasicMaterial({ color: 0x70d6b5 }),
        );
        marker.position.copy(center).addScaledVector(normal, length * 0.014);
        state.model.add(marker);
      }
      for (const load of props.project.study.loads.filter((item) =>
        item.regions.includes(region),
      )) {
        const direction =
          load.kind === 'pressure'
            ? normal.clone().multiplyScalar(-Math.sign(load.pressure))
            : new THREE.Vector3(...load.vector).normalize();
        if (direction.lengthSq() === 0) continue;
        const arrow = new THREE.ArrowHelper(
          direction,
          center.clone().addScaledVector(direction, -length * 0.18),
          length * 0.18,
          0xf5ac66,
          length * 0.045,
          length * 0.027,
        );
        state.model.add(arrow);
      }
    }
    if (state.grid) {
      state.scene.remove(state.grid);
      state.grid.geometry.dispose();
      (Array.isArray(state.grid.material) ? state.grid.material : [state.grid.material]).forEach(
        (material) => material.dispose(),
      );
    }
    const grid = new THREE.GridHelper(length * 4, 24, 0x2b4553, 0x203540);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(
      bounds.getCenter(new THREE.Vector3()).x,
      bounds.getCenter(new THREE.Vector3()).y,
      bounds.min.z - length * 0.04,
    );
    state.grid = grid;
    state.scene.add(grid);
    if (lastProject.current !== `${props.project.id}-${props.project.study.dimension}`) {
      state.fit();
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
          const target = plane
            ? new THREE.Vector3(bounds.max.x - length * 1e-6, center.y, 0)
            : center;
          const ray = new THREE.Raycaster(
            target
              .clone()
              .add(
                plane ? new THREE.Vector3(0, 0, length * 3) : new THREE.Vector3(length * 3, 0, 0),
              ),
            plane ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0),
          );
          const hit = ray.intersectObject(surface)[0];
          const triangle = hit?.faceIndex ?? -1;
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
            renderedTriangles: data.triangles.length / 3,
            field: props.field!.label,
            association: props.field!.association,
            pickedRegion:
              triangle >= 0 && hit
                ? pickedRegion(data, triangle, hit.point, state.scale, length)
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
    props.project,
    props.data,
    props.field,
    props.selected,
    props.edges,
    props.deformation,
    props.customScale,
    props.source,
    props.animate,
    !!props.onVerified,
  ]);

  return (
    <div className="viewport">
      <div
        ref={container}
        className="viewport-canvas"
        aria-label={
          props.project.study.dimension === '2d'
            ? 'Interactive plane stress model. Drag to pan, scroll to zoom, click edges to select.'
            : 'Interactive 3D model. Drag to orbit, scroll to zoom, click boundaries to select.'
        }
      />
      {error && <div className="viewport-error">{error}</div>}
      <div className="viewport-actions">
        <button title="Fit model (F)" aria-label="Fit model" onClick={() => runtime.current?.fit()}>
          <Maximize size={16} />
        </button>
        <button
          title="Reset camera"
          aria-label="Reset camera"
          onClick={() => runtime.current?.fit()}
        >
          <RotateCcw size={16} />
        </button>
      </div>
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
      </div>
      <div className="viewport-help">
        {props.project.study.dimension === '2d' ? 'Drag to pan' : 'Drag to orbit'} <i /> Scroll to
        zoom <i />{' '}
        {props.project.study.dimension === '2d'
          ? 'Click edges to select · interior to probe'
          : 'Click faces to toggle selection'}
      </div>
    </div>
  );
}
