import type {
  CadSketchConstraint,
  CadSketchDefinition,
  CadSketchEntity,
  Point2,
} from '../../domain/contracts/project.generated';

export type SketchSelection = { kind: 'point' | 'entity'; id: string };
export type SketchView = { center: Point2; width: number; height: number };
export type SnappedPoint = {
  position: Point2;
  pointId?: string;
  kind: 'endpoint' | 'origin' | 'grid' | 'horizontal' | 'vertical' | 'none';
};
export const freshSketchId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
export const pointDistance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Compact presentation of solver noise; this function never changes the authored number. */
export function formatSketchNumber(value: number, sketchSpan: number): string {
  if (Math.abs(value) <= Math.abs(sketchSpan) * 1e-12) return '0';
  return Number(value.toPrecision(12)).toString();
}
const cross = (a: Point2, b: Point2, c: Point2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function bounded(sketch: CadSketchDefinition): CadSketchDefinition {
  if (
    sketch.points.length > 256 ||
    sketch.entities.length > 256 ||
    sketch.constraints.length > 512 ||
    sketch.loops.length > 64
  )
    throw new Error('This sketch has reached its point, curve, constraint or loop limit.');
  for (const point of sketch.points)
    if (!point.position.every((value) => Number.isFinite(value) && Math.abs(value) <= 1000))
      throw new Error('Sketch coordinates must be finite and within ±1000 m.');
  return sketch;
}
function putPoint(sketch: CadSketchDefinition, value: SnappedPoint): string {
  if (value.pointId && sketch.points.some((point) => point.id === value.pointId))
    return value.pointId;
  const id = freshSketchId('point');
  sketch.points.push({ id, position: [...value.position] });
  return id;
}
export function entityPoints(sketch: CadSketchDefinition, entity: CadSketchEntity): Point2[] {
  const get = (id: string): Point2 => sketch.points.find((point) => point.id === id)!.position;
  if (entity.kind === 'line') return [get(entity.startId), get(entity.endId)];
  const center = get(entity.centerId);
  if (entity.kind === 'circle')
    return Array.from({ length: 65 }, (_, i) => [
      center[0] + entity.radius * Math.cos((i / 64) * Math.PI * 2),
      center[1] + entity.radius * Math.sin((i / 64) * Math.PI * 2),
    ]);
  const start = get(entity.startId),
    end = get(entity.endId);
  const a = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let angle = Math.atan2(end[1] - center[1], end[0] - center[0]) - a;
  if (entity.clockwise && angle >= 0) angle -= Math.PI * 2;
  if (!entity.clockwise && angle <= 0) angle += Math.PI * 2;
  const radius = pointDistance(start, center);
  return Array.from({ length: 33 }, (_, i) => [
    center[0] + radius * Math.cos(a + (angle * i) / 32),
    center[1] + radius * Math.sin(a + (angle * i) / 32),
  ]);
}
export function fitSketchView(sketch: CadSketchDefinition, aspect = 1.6): SketchView {
  const points = [
    ...sketch.points.map((point) => point.position),
    ...sketch.entities.flatMap((entity) => entityPoints(sketch, entity)),
  ];
  if (!points.length) return { center: [0, 0], width: 0.24, height: 0.24 / aspect };
  const minX = Math.min(...points.map((point) => point[0])),
    maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1])),
    maxY = Math.max(...points.map((point) => point[1]));
  const width = Math.max((maxX - minX) * 1.4, (maxY - minY) * aspect * 1.4, 1e-5);
  return { center: [(minX + maxX) / 2, (minY + maxY) / 2], width, height: width / aspect };
}
/** Offset length labels away from their contour; presentation never changes the graph. */
export function lineDimensionPosition(
  sketch: CadSketchDefinition,
  entity: CadSketchEntity,
  offset: number,
): Point2 {
  const vertices = entityPoints(sketch, entity),
    start = vertices[0],
    end = vertices.at(-1)!;
  const middle: Point2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const length = pointDistance(start, end);
  if (length < 1e-12) return middle;
  const normal: Point2 = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
  const loop = sketch.loops.find((item) => item.entityIds.includes(entity.id));
  let sign = normal[1] < 0 || (normal[1] === 0 && normal[0] < 0) ? -1 : 1;
  if (loop) {
    const contour = loop.entityIds.flatMap((id) =>
      entityPoints(
        sketch,
        sketch.entities.find((item) => item.id === id)!,
      ),
    );
    const center: Point2 = [
      contour.reduce((sum, point) => sum + point[0], 0) / contour.length,
      contour.reduce((sum, point) => sum + point[1], 0) / contour.length,
    ];
    sign = (middle[0] - center[0]) * normal[0] + (middle[1] - center[1]) * normal[1] < 0 ? -1 : 1;
  }
  return [middle[0] + normal[0] * offset * sign, middle[1] + normal[1] * offset * sign];
}
export function sketchGridSpacing(view: SketchView): number {
  const target = view.width / 16,
    power = 10 ** Math.floor(Math.log10(target));
  return (target / power < 2 ? 1 : target / power < 5 ? 2 : 5) * power;
}
/** Snap identities are reused; coordinate proximity never silently merges authored points. */
export function snapSketchPoint(
  sketch: CadSketchDefinition,
  position: Point2,
  tolerance: number,
  spacing: number,
  reference?: Point2,
  excludePointId?: string,
): SnappedPoint {
  const nearest = sketch.points
    .filter((point) => point.id !== excludePointId)
    .map((point) => ({ point, distance: pointDistance(point.position, position) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance <= tolerance)
    return { position: [...nearest.point.position], pointId: nearest.point.id, kind: 'endpoint' };
  if (pointDistance(position, [0, 0]) <= tolerance) return { position: [0, 0], kind: 'origin' };
  if (reference && Math.abs(position[1] - reference[1]) <= tolerance)
    return {
      position: [Math.round(position[0] / spacing) * spacing, reference[1]],
      kind: 'horizontal',
    };
  if (reference && Math.abs(position[0] - reference[0]) <= tolerance)
    return {
      position: [reference[0], Math.round(position[1] / spacing) * spacing],
      kind: 'vertical',
    };
  return {
    position: position.map((value) => Math.round(value / spacing) * spacing) as Point2,
    kind: 'grid',
  };
}
function inside(point: Point2, polygon: Point2[]): boolean {
  let value = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      value = !value;
  }
  return value;
}
/** Only topologically closed degree-two components become loops; open construction is retained. */
export function refreshSketchLoops(input: CadSketchDefinition): CadSketchDefinition {
  const sketch = structuredClone(input),
    visited = new Set<string>();
  const candidates: { ids: string[]; polygon: Point2[] }[] = [];
  const connected = (pointId: string) =>
    sketch.entities.filter(
      (entity) =>
        entity.kind !== 'circle' && (entity.startId === pointId || entity.endId === pointId),
    );
  for (const seed of sketch.entities) {
    if (visited.has(seed.id)) continue;
    if (seed.kind === 'circle') {
      visited.add(seed.id);
      candidates.push({ ids: [seed.id], polygon: entityPoints(sketch, seed) });
      continue;
    }
    const component: CadSketchEntity[] = [],
      queue: CadSketchEntity[] = [seed];
    while (queue.length) {
      const entity = queue.pop()!;
      if (visited.has(entity.id)) continue;
      visited.add(entity.id);
      component.push(entity);
      if (entity.kind !== 'circle')
        queue.push(...connected(entity.startId), ...connected(entity.endId));
    }
    if (
      component.some(
        (entity) =>
          entity.kind === 'circle' ||
          connected(entity.startId).length !== 2 ||
          connected(entity.endId).length !== 2,
      )
    )
      continue;
    const ids: string[] = [],
      polygon: Point2[] = [];
    let pointId = seed.startId,
      entity: CadSketchEntity | undefined = seed;
    while (entity && !ids.includes(entity.id) && entity.kind !== 'circle') {
      ids.push(entity.id);
      const samples = entityPoints(sketch, entity);
      if (entity.startId !== pointId) samples.reverse();
      polygon.push(...samples.slice(0, -1));
      pointId = entity.startId === pointId ? entity.endId : entity.startId;
      entity = connected(pointId).find((item) => !ids.includes(item.id));
    }
    if (pointId === seed.startId && ids.length === component.length)
      candidates.push({ ids, polygon });
  }
  sketch.loops = candidates.map((candidate) => {
    const previous = input.loops.find(
      (loop) =>
        loop.entityIds.length === candidate.ids.length &&
        loop.entityIds.every((id) => candidate.ids.includes(id)),
    );
    const depth = candidates.filter(
      (other) =>
        other !== candidate && candidate.polygon.every((point) => inside(point, other.polygon)),
    ).length;
    return {
      id: previous?.id ?? freshSketchId('loop'),
      entityIds: candidate.ids as [string, ...string[]],
      role: previous?.role ?? (depth % 2 ? 'hole' : 'outer'),
    };
  });
  return bounded(sketch);
}
export function sketchReadiness(sketch: CadSketchDefinition): {
  closedLoops: number;
  openEntities: number;
  issue: string | null;
} {
  const loopEntities = new Set(sketch.loops.flatMap((loop) => loop.entityIds));
  const openEntities = sketch.entities.filter((entity) => !loopEntities.has(entity.id)).length;
  const outers = sketch.loops.filter((loop) => loop.role === 'outer').length;
  const issue = !sketch.entities.length
    ? 'Draw a closed outline before rebuilding this sketch.'
    : openEntities
      ? `${openEntities} open curve${openEntities === 1 ? '' : 's'} remain. Close or delete them before rebuilding.`
      : outers !== 1
        ? 'Choose exactly one outer loop; enclosed closed loops can be holes.'
        : null;
  return { closedLoops: sketch.loops.length, openEntities, issue };
}
export function addSketchLine(
  input: CadSketchDefinition,
  a: SnappedPoint,
  b: SnappedPoint,
): CadSketchDefinition {
  if (pointDistance(a.position, b.position) < 1e-10)
    throw new Error('Choose two distinct line endpoints.');
  const sketch = structuredClone(input),
    startId = putPoint(sketch, a),
    endId = putPoint(sketch, b);
  const id = freshSketchId('line');
  sketch.entities.push({
    id,
    name: `Line ${sketch.entities.length + 1}`,
    kind: 'line',
    startId,
    endId,
  });
  if (b.kind === 'horizontal' || b.kind === 'vertical')
    sketch.constraints.push({ id: freshSketchId('constraint'), kind: b.kind, lineId: id });
  return refreshSketchLoops(sketch);
}
export function addSketchRectangle(
  input: CadSketchDefinition,
  a: SnappedPoint,
  b: SnappedPoint,
): CadSketchDefinition {
  if (
    Math.abs(a.position[0] - b.position[0]) < 1e-10 ||
    Math.abs(a.position[1] - b.position[1]) < 1e-10
  )
    throw new Error('Choose opposite corners with nonzero width and height.');
  const sketch = structuredClone(input),
    ids = [
      putPoint(sketch, a),
      putPoint(sketch, { position: [b.position[0], a.position[1]], kind: 'none' }),
      putPoint(sketch, b),
      putPoint(sketch, { position: [a.position[0], b.position[1]], kind: 'none' }),
    ];
  for (let i = 0; i < 4; i++) {
    const id = freshSketchId('line');
    sketch.entities.push({
      id,
      name: `Rectangle edge ${i + 1}`,
      kind: 'line',
      startId: ids[i],
      endId: ids[(i + 1) % 4],
    });
    sketch.constraints.push({
      id: freshSketchId('constraint'),
      kind: i % 2 ? 'vertical' : 'horizontal',
      lineId: id,
    });
  }
  return refreshSketchLoops(sketch);
}
export function addSketchCircle(
  input: CadSketchDefinition,
  center: SnappedPoint,
  edge: Point2,
): CadSketchDefinition {
  const radius = pointDistance(center.position, edge);
  if (!(radius > 1e-10) || radius > 1000)
    throw new Error('Circle radius must be greater than zero and at most 1000 m.');
  const sketch = structuredClone(input),
    centerId = putPoint(sketch, center);
  sketch.entities.push({
    id: freshSketchId('circle'),
    name: `Circle ${sketch.entities.length + 1}`,
    kind: 'circle',
    centerId,
    radius,
  });
  return refreshSketchLoops(sketch);
}
export function threePointArc(
  a: Point2,
  middle: Point2,
  b: Point2,
): { center: Point2; clockwise: boolean } {
  const determinant = 2 * cross(a, middle, b),
    scale = Math.max(pointDistance(a, middle), pointDistance(middle, b), pointDistance(a, b));
  if (scale < 1e-10 || Math.abs(determinant) < scale * scale * 1e-8)
    throw new Error('Choose three distinct points that are not on one straight line.');
  // Work in local coordinates to avoid cancellation for small sketches far from the origin.
  const u: Point2 = [middle[0] - a[0], middle[1] - a[1]],
    v: Point2 = [b[0] - a[0], b[1] - a[1]];
  const uu = u[0] * u[0] + u[1] * u[1],
    vv = v[0] * v[0] + v[1] * v[1];
  return {
    center: [
      a[0] + (uu * v[1] - vv * u[1]) / determinant,
      a[1] + (u[0] * vv - v[0] * uu) / determinant,
    ],
    clockwise: cross(a, middle, b) < 0,
  };
}
export function addSketchThreePointArc(
  input: CadSketchDefinition,
  a: SnappedPoint,
  middle: Point2,
  b: SnappedPoint,
): CadSketchDefinition {
  const curve = threePointArc(a.position, middle, b.position),
    sketch = structuredClone(input);
  const startId = putPoint(sketch, a),
    endId = putPoint(sketch, b),
    centerId = putPoint(sketch, { position: curve.center, kind: 'none' });
  sketch.entities.push({
    id: freshSketchId('arc'),
    name: `Arc ${sketch.entities.length + 1}`,
    kind: 'arc',
    startId,
    endId,
    centerId,
    clockwise: curve.clockwise,
  });
  return refreshSketchLoops(sketch);
}
export function moveSketchPoint(
  input: CadSketchDefinition,
  id: string,
  position: Point2,
): CadSketchDefinition {
  const sketch = structuredClone(input),
    point = sketch.points.find((item) => item.id === id);
  if (!point) throw new Error('The selected point no longer exists.');
  const oldPosition = [...point.position] as Point2;
  point.position = [...position];
  for (const entity of sketch.entities) {
    if (entity.kind !== 'arc') continue;
    const get = (pointId: string) => sketch.points.find((item) => item.id === pointId)!;
    if (entity.centerId === id) {
      const delta: Point2 = [position[0] - oldPosition[0], position[1] - oldPosition[1]];
      for (const pointId of [entity.startId, entity.endId]) {
        if (
          sketch.entities.some(
            (other) => other.id !== entity.id && entityPointIds(other).includes(pointId),
          )
        )
          throw new Error('This arc shares endpoints. Drag an endpoint instead of its center.');
        const endpoint = get(pointId);
        endpoint.position = [endpoint.position[0] + delta[0], endpoint.position[1] + delta[1]];
      }
    } else if (entity.startId === id || entity.endId === id) {
      if (
        sketch.entities.some(
          (other) => other.id !== entity.id && entityPointIds(other).includes(entity.centerId),
        )
      )
        throw new Error('This arc shares its center. Edit its constraints instead.');
      const oldA = input.points.find((item) => item.id === entity.startId)!.position,
        oldB = input.points.find((item) => item.id === entity.endId)!.position;
      const oldC = input.points.find((item) => item.id === entity.centerId)!.position,
        oldLength = pointDistance(oldA, oldB);
      const a = get(entity.startId).position,
        b = get(entity.endId).position,
        length = pointDistance(a, b);
      if (length < 1e-10 || oldLength < 1e-10)
        throw new Error('Arc endpoints must remain distinct.');
      const ratio = cross(oldA, oldB, oldC) / (oldLength * oldLength);
      get(entity.centerId).position = [
        (a[0] + b[0]) / 2 - (b[1] - a[1]) * ratio,
        (a[1] + b[1]) / 2 + (b[0] - a[0]) * ratio,
      ];
    }
  }
  // SolveSpace fixes the supplied coordinates, so ordinary dragging must never relocate an anchor.
  for (const constraint of input.constraints) {
    if (constraint.kind !== 'fixedPoint') continue;
    const before = input.points.find((item) => item.id === constraint.pointId)!,
      after = sketch.points.find((item) => item.id === constraint.pointId)!;
    if (pointDistance(before.position, after.position) > 1e-12)
      throw new Error('This point is fixed. Remove its fixed constraint before moving its anchor.');
  }
  return refreshSketchLoops(sketch);
}
export function entityPointIds(entity: CadSketchEntity): string[] {
  return entity.kind === 'line'
    ? [entity.startId, entity.endId]
    : entity.kind === 'circle'
      ? [entity.centerId]
      : [entity.startId, entity.endId, entity.centerId];
}
function constraintReferences(constraint: CadSketchConstraint): string[] {
  return Object.entries(constraint)
    .filter(([key]) => key.endsWith('Id'))
    .map(([, value]) => String(value));
}
export function deleteSketchSelection(
  input: CadSketchDefinition,
  selections: SketchSelection[],
): CadSketchDefinition {
  const ids = new Set(selections.map((selection) => selection.id));
  for (const constraint of input.constraints)
    if (constraintReferences(constraint).some((id) => ids.has(id)))
      throw new Error(
        `Remove the ${constraint.kind} constraint before deleting its referenced geometry.`,
      );
  for (const selection of selections)
    if (
      selection.kind === 'point' &&
      input.entities.some(
        (entity) => !ids.has(entity.id) && entityPointIds(entity).includes(selection.id),
      )
    )
      throw new Error('Delete the curves using this point first.');
  const sketch = structuredClone(input);
  const removedPointCandidates = new Set(
    input.entities.filter((entity) => ids.has(entity.id)).flatMap(entityPointIds),
  );
  sketch.entities = sketch.entities.filter((entity) => !ids.has(entity.id));
  const referencedPoints = new Set(sketch.entities.flatMap(entityPointIds));
  for (const constraint of sketch.constraints)
    for (const id of constraintReferences(constraint)) referencedPoints.add(id);
  sketch.points = sketch.points.filter(
    (point) =>
      !ids.has(point.id) &&
      (!removedPointCandidates.has(point.id) || referencedPoints.has(point.id)),
  );
  return refreshSketchLoops(sketch);
}
