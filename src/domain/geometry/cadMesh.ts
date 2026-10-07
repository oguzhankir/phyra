import type { CadArrayDescriptor, CadPreview } from './cadPreview';

/** Transient mesh evidence. Region IDs have meaning only inside this receipt. */
export interface CadMeshReceipt {
  protocolVersion: 1;
  operation: 'mesh-cad';
  purpose: 'inspection-only';
  status: 'succeeded';
  projectId: string;
  revision: number;
  jobId: string;
  geometryFingerprint: string;
  outputFeatureId: string;
  coordinateFrame: 'cartesian-global-SI';
  targetSize: number;
  meshId: string;
  mesher: { name: 'Gmsh'; version: string; element: 'tetra4' };
  byteLength: number;
  bufferHash: string;
  arrays: Record<
    'positions' | 'cells' | 'surface' | 'surfaceRegions' | 'surfaceCells' | 'quality',
    CadArrayDescriptor & { association: 'node' | 'cell' | 'triangle'; units: 'm' | '1' }
  >;
  regions: {
    id: string;
    name: string;
    identity: 'mesh-scoped';
    triangleCount: number;
    area: number;
  }[];
  statistics: {
    bounds: [[number, number, number], [number, number, number]];
    nodes: number;
    cells: number;
    surfaceTriangles: number;
    boundaryRegions: number;
    minQuality: number;
    maxQuality: number;
    meanQuality: number;
    exactVolume: number;
    meshVolume: number;
    relativeVolumeError: number;
    exactSurfaceArea: number;
    meshSurfaceArea: number;
  };
}

export interface CadMeshPreview {
  receipt: CadMeshReceipt;
  positions: Float64Array;
  cells: Uint32Array;
  surface: Uint32Array;
  surfaceRegions: Uint32Array;
  surfaceCells: Uint32Array;
  quality: Float64Array;
}

const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const count = (value: number, maximum: number) =>
  Number.isSafeInteger(value) && value > 0 && value <= maximum;

export function validateCadMeshReceipt(
  receipt: CadMeshReceipt,
  source: { id: string; revision: number },
  targetSize: number,
): void {
  const stats = receipt?.statistics;
  if (
    !receipt ||
    receipt.protocolVersion !== 1 ||
    receipt.operation !== 'mesh-cad' ||
    receipt.purpose !== 'inspection-only' ||
    receipt.status !== 'succeeded' ||
    receipt.projectId !== source.id ||
    receipt.revision !== source.revision ||
    !positive(targetSize) ||
    targetSize > 1000 ||
    receipt.targetSize !== targetSize ||
    'analysisCompatibility' in receipt ||
    'assets' in receipt ||
    receipt.coordinateFrame !== 'cartesian-global-SI' ||
    typeof receipt.jobId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(receipt.jobId) ||
    !hash(receipt.geometryFingerprint) ||
    !hash(receipt.bufferHash) ||
    !hash(receipt.meshId) ||
    receipt.mesher?.name !== 'Gmsh' ||
    receipt.mesher.element !== 'tetra4' ||
    typeof receipt.mesher.version !== 'string' ||
    !receipt.mesher.version.length ||
    receipt.mesher.version.length > 100 ||
    !count(receipt.byteLength, 64 * 1024 * 1024) ||
    !stats ||
    !count(stats.nodes, 12000) ||
    stats.nodes < 4 ||
    !count(stats.cells, 50000) ||
    !count(stats.surfaceTriangles, 100000) ||
    !count(stats.boundaryRegions, 2048) ||
    !Array.isArray(receipt.regions) ||
    receipt.regions.length !== stats.boundaryRegions ||
    new Set(receipt.regions.map((region) => region?.id)).size !== receipt.regions.length ||
    receipt.regions.some(
      (region, index) =>
        !region ||
        region.id !== `mesh-face-${index + 1}` ||
        typeof region.name !== 'string' ||
        !region.name.length ||
        region.name.length > 200 ||
        region.identity !== 'mesh-scoped' ||
        !count(region.triangleCount, stats.surfaceTriangles) ||
        !positive(region.area),
    ) ||
    !Array.isArray(stats.bounds) ||
    stats.bounds.length !== 2 ||
    stats.bounds.some(
      (corner) => !Array.isArray(corner) || corner.length !== 3 || !corner.every(Number.isFinite),
    ) ||
    stats.bounds[0].some((value, axis) => value >= stats.bounds[1][axis]) ||
    ![stats.exactVolume, stats.meshVolume, stats.exactSurfaceArea, stats.meshSurfaceArea].every(
      positive,
    ) ||
    !Number.isFinite(stats.relativeVolumeError) ||
    stats.relativeVolumeError < 0 ||
    !positive(stats.minQuality) ||
    !Number.isFinite(stats.maxQuality) ||
    stats.maxQuality > 1 + 1e-12 ||
    stats.maxQuality < stats.minQuality ||
    !Number.isFinite(stats.meanQuality) ||
    stats.meanQuality < stats.minQuality ||
    stats.meanQuality > stats.maxQuality
  )
    throw new Error('Mesh inspection receipt failed identity or resource validation.');
}

/** Validate every binary view before it can reach the renderer. */
export function decodeCadMesh(receipt: CadMeshReceipt, buffer: ArrayBuffer): CadMeshPreview {
  validateCadMeshReceipt(
    receipt,
    { id: receipt.projectId, revision: receipt.revision },
    receipt.targetSize,
  );
  if (buffer.byteLength !== receipt.byteLength)
    throw new Error('Mesh inspection buffer size does not match its receipt.');
  const intervals: [number, number][] = [];
  const array = (
    name: keyof CadMeshReceipt['arrays'],
    dtype: 'float64' | 'uint32',
    rows: number,
    width: number,
  ) => {
    const descriptor = receipt.arrays?.[name];
    const bytes = dtype === 'float64' ? 8 : 4;
    if (
      !descriptor ||
      descriptor.dtype !== dtype ||
      descriptor.units !== (name === 'positions' ? 'm' : '1') ||
      descriptor.association !==
        (name === 'positions'
          ? 'node'
          : name === 'cells' || name === 'quality'
            ? 'cell'
            : 'triangle') ||
      !Number.isSafeInteger(descriptor.offset) ||
      descriptor.offset < 0 ||
      descriptor.offset % 8 ||
      !Number.isSafeInteger(descriptor.byteLength) ||
      descriptor.byteLength !== rows * width * bytes ||
      descriptor.offset + descriptor.byteLength > buffer.byteLength ||
      !Array.isArray(descriptor.shape) ||
      descriptor.shape.length !== (width === 1 ? 1 : 2) ||
      descriptor.shape[0] !== rows ||
      (width !== 1 && descriptor.shape[1] !== width) ||
      intervals.some(
        ([start, end]) =>
          descriptor.offset < end && descriptor.offset + descriptor.byteLength > start,
      )
    )
      throw new Error(`Invalid mesh inspection array ${name}.`);
    intervals.push([descriptor.offset, descriptor.offset + descriptor.byteLength]);
    return dtype === 'float64'
      ? new Float64Array(buffer, descriptor.offset, rows * width)
      : new Uint32Array(buffer, descriptor.offset, rows * width);
  };
  const stats = receipt.statistics;
  const positions = array('positions', 'float64', stats.nodes, 3) as Float64Array;
  const cells = array('cells', 'uint32', stats.cells, 4) as Uint32Array;
  const surface = array('surface', 'uint32', stats.surfaceTriangles, 3) as Uint32Array;
  const surfaceRegions = array(
    'surfaceRegions',
    'uint32',
    stats.surfaceTriangles,
    1,
  ) as Uint32Array;
  const surfaceCells = array('surfaceCells', 'uint32', stats.surfaceTriangles, 1) as Uint32Array;
  const quality = array('quality', 'float64', stats.cells, 1) as Float64Array;
  if (
    !positions.every(Number.isFinite) ||
    cells.some((index) => index >= stats.nodes) ||
    surface.some((index) => index >= stats.nodes) ||
    surfaceRegions.some((index) => index >= receipt.regions.length) ||
    surfaceCells.some((index) => index >= stats.cells) ||
    quality.some((value) => !positive(value) || value > 1 + 1e-12)
  )
    throw new Error('Mesh inspection coordinates, connectivity or quality are invalid.');
  const regionCounts = new Uint32Array(receipt.regions.length);
  for (let triangle = 0; triangle < stats.surfaceTriangles; triangle++) {
    const face = surface.subarray(triangle * 3, triangle * 3 + 3);
    const owner = cells.subarray(surfaceCells[triangle] * 4, surfaceCells[triangle] * 4 + 4);
    if (new Set(face).size !== 3 || face.some((node) => !owner.includes(node)))
      throw new Error('Mesh inspection surface has an invalid owning cell.');
    regionCounts[surfaceRegions[triangle]]++;
  }
  if (receipt.regions.some((region, i) => region.triangleCount !== regionCounts[i]))
    throw new Error('Mesh inspection region counts do not match its surface.');
  return { receipt, positions, cells, surface, surfaceRegions, surfaceCells, quality };
}

/** Rendering adapter only: these entities must never become CAD selections. */
export function cadMeshDisplay(mesh: CadMeshPreview): CadPreview {
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i < mesh.surface.length; i += 3)
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const first = mesh.surface[i + a],
        second = mesh.surface[i + b];
      edges.set(`${Math.min(first, second)}:${Math.max(first, second)}`, [first, second]);
    }
  return {
    positions: mesh.positions,
    triangles: mesh.surface,
    triangleFaces: mesh.surfaceRegions,
    edgePositions: mesh.positions,
    edgeSegments: Uint32Array.from(Array.from(edges.values()).flat()),
    segmentEdges: new Uint32Array(edges.size),
    faces: mesh.receipt.regions.map((region) => ({
      id: `${mesh.receipt.jobId}:${region.id}`,
      name: region.name,
      identity: 'ambiguous',
    })),
    edges: [{ id: `${mesh.receipt.jobId}:mesh-edges`, name: 'Mesh edges', identity: 'ambiguous' }],
    bodies: [],
  };
}
