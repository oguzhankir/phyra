export interface CadArrayDescriptor {
  offset: number;
  byteLength: number;
  dtype: 'float64' | 'uint32';
  shape: number[];
}
export interface CadEntity {
  id: string;
  name: string;
  identity: 'content-reference' | 'ambiguous';
  bodyId?: string;
  componentId?: string;
  componentPath?: string[];
  sourceFeatureId?: string;
}
export interface CadPreview {
  positions: Float64Array;
  triangles: Uint32Array;
  triangleFaces: Uint32Array;
  edgePositions: Float64Array;
  edgeSegments: Uint32Array;
  segmentEdges: Uint32Array;
  faces: CadEntity[];
  edges: CadEntity[];
  bodies: CadEntity[];
}

/** Validate every array that reaches the renderer, independently of kernel publication. */
export function cadPreview(
  receipt: {
    byteLength: number;
    arrays: Record<string, CadArrayDescriptor>;
    faces: CadEntity[];
    edges: CadEntity[];
    bodies: CadEntity[];
  },
  buffer: ArrayBuffer,
): CadPreview {
  if (buffer.byteLength !== receipt.byteLength || buffer.byteLength > 64 * 1024 * 1024)
    throw new Error('CAD preview buffer size does not match its receipt.');
  const intervals: [number, number][] = [];
  const array = (name: string, dtype: 'float64' | 'uint32', width: number) => {
    const d = receipt.arrays[name];
    const bytes = dtype === 'float64' ? 8 : 4;
    if (
      !d ||
      d.dtype !== dtype ||
      !Number.isSafeInteger(d.offset) ||
      !Number.isSafeInteger(d.byteLength) ||
      d.offset < 0 ||
      d.byteLength < 0 ||
      d.offset % bytes ||
      d.byteLength % bytes ||
      d.offset + d.byteLength > buffer.byteLength ||
      !d.shape.every(Number.isSafeInteger) ||
      d.shape.some((n) => n < 0) ||
      d.shape.length !== (width === 1 ? 1 : 2) ||
      (width !== 1 && d.shape[1] !== width) ||
      d.shape[0] > 300000 ||
      d.shape[0] * width * bytes !== d.byteLength
    )
      throw new Error(`Invalid CAD preview array ${name}.`);
    if (intervals.some(([start, end]) => d.offset < end && d.offset + d.byteLength > start))
      throw new Error('CAD preview arrays overlap.');
    intervals.push([d.offset, d.offset + d.byteLength]);
    return dtype === 'float64'
      ? new Float64Array(buffer, d.offset, d.byteLength / bytes)
      : new Uint32Array(buffer, d.offset, d.byteLength / bytes);
  };
  const positions = array('positions', 'float64', 3) as Float64Array;
  const triangles = array('triangles', 'uint32', 3) as Uint32Array;
  const triangleFaces = array('triangleFaces', 'uint32', 1) as Uint32Array;
  const edgePositions = array('edgePositions', 'float64', 3) as Float64Array;
  const edgeSegments = array('edgeSegments', 'uint32', 2) as Uint32Array;
  const segmentEdges = array('segmentEdges', 'uint32', 1) as Uint32Array;
  if (
    !positions.every(Number.isFinite) ||
    !edgePositions.every(Number.isFinite) ||
    triangles.some((index) => index >= positions.length / 3) ||
    edgeSegments.some((index) => index >= edgePositions.length / 3) ||
    triangleFaces.length !== triangles.length / 3 ||
    segmentEdges.length !== edgeSegments.length / 2 ||
    triangleFaces.some((index) => index >= receipt.faces.length) ||
    segmentEdges.some((index) => index >= receipt.edges.length)
  )
    throw new Error('CAD preview coordinates or entity associations are invalid.');
  for (const entities of [receipt.faces, receipt.edges, receipt.bodies]) {
    if (
      entities.length > 2048 ||
      new Set(entities.map((entity) => entity.id)).size !== entities.length ||
      entities.some(
        (entity) =>
          !entity.id ||
          entity.id.length > 200 ||
          !entity.name ||
          Array.from(entity.name).length > 200 ||
          !['content-reference', 'ambiguous'].includes(entity.identity),
      )
    )
      throw new Error('CAD preview entity metadata is invalid.');
  }
  const ids = new Set(receipt.bodies.map((body) => body.id));
  const identifier = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  for (const entity of [...receipt.faces, ...receipt.edges, ...receipt.bodies]) {
    if (
      entity.bodyId !== undefined &&
      (typeof entity.bodyId !== 'string' || !ids.has(entity.bodyId))
    )
      throw new Error('CAD entity refers to an unavailable body.');
    if (entity.sourceFeatureId !== undefined && !identifier(entity.sourceFeatureId))
      throw new Error('CAD source feature identity is invalid.');
    if (entity.componentId !== undefined || entity.componentPath !== undefined) {
      if (
        !identifier(entity.componentId) ||
        !Array.isArray(entity.componentPath) ||
        !entity.componentPath.length ||
        entity.componentPath.length > 128 ||
        !entity.componentPath.every(identifier) ||
        entity.componentPath[0] !== entity.componentId
      )
        throw new Error('CAD component identity is invalid.');
    }
  }
  return {
    positions,
    triangles,
    triangleFaces,
    edgePositions,
    edgeSegments,
    segmentEdges,
    faces: receipt.faces,
    edges: receipt.edges,
    bodies: receipt.bodies,
  };
}
