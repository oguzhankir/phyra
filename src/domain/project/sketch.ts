import type { Point2, Profile } from '../contracts/project.generated';
import { sampleSegment } from './profile';

export type SketchBounds = { left: number; bottom: number; width: number; height: number };
const validPoint = (point: Point2) =>
  point.every((value) => Number.isFinite(value) && Math.abs(value) <= 1000);
const copyPoint = (point: Point2): Point2 => [point[0], point[1]];

export function sketchBounds(profile: Profile): SketchBounds {
  const points = profile.outer.flatMap((segment) => sampleSegment(segment));
  for (const hole of profile.holes)
    points.push(
      [hole.center[0] - hole.radius, hole.center[1] - hole.radius],
      [hole.center[0] + hole.radius, hole.center[1] + hole.radius],
    );
  const finite = points.filter(validPoint);
  if (!finite.length) return { left: -1, bottom: -0.625, width: 2, height: 1.25 };
  const minX = Math.min(...finite.map((point) => point[0])),
    maxX = Math.max(...finite.map((point) => point[0]));
  const minY = Math.min(...finite.map((point) => point[1])),
    maxY = Math.max(...finite.map((point) => point[1]));
  const width = Math.max(maxX - minX, (maxY - minY) * 1.6, 1e-9) * 1.35;
  const height = width / 1.6;
  return { left: (minX + maxX - width) / 2, bottom: (minY + maxY - height) / 2, width, height };
}

export function snapPoint(point: Point2, spacing: number): Point2 {
  if (!validPoint(point) || !Number.isFinite(spacing) || spacing <= 0) return copyPoint(point);
  return point.map((value) => Math.round(value / spacing) * spacing) as Point2;
}

export function sketchGridSpacing(bounds: SketchBounds): number {
  const target = bounds.width / 40;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find((value) => value * power >= target) ?? 10;
  return step * power;
}

/** Shared endpoints stay exactly equal; arc feasibility is checked before applying the draft. */
export function moveSketchVertex(profile: Profile, index: number, point: Point2): Profile {
  if (!validPoint(point)) throw new Error('Coordinates must be finite and within ±1,000 m.');
  const next = structuredClone(profile);
  if (!next.outer[index]) throw new Error('The selected vertex no longer exists.');
  next.outer[index].start = copyPoint(point);
  next.outer[(index + next.outer.length - 1) % next.outer.length].end = copyPoint(point);
  return next;
}

function nextId(used: Set<string>, prefix: string) {
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index++;
  const id = `${prefix}-${index}`;
  used.add(id);
  return id;
}

/** New topology gets new IDs, including reservation of IDs still owned by conditions. */
export function replaceSketchLoop(
  profile: Profile,
  points: Point2[],
  reservedIds: string[],
): Profile {
  if (points.length < 3 || points.length > 64 || !points.every(validPoint))
    throw new Error('Draw 3–64 finite vertices within ±1,000 m.');
  const vertices = points.map(copyPoint);
  const origin = vertices[0];
  const area = vertices.reduce((sum, point, index) => {
    const end = vertices[(index + 1) % vertices.length];
    return (
      sum +
      (point[0] - origin[0]) * (end[1] - origin[1]) -
      (point[1] - origin[1]) * (end[0] - origin[0])
    );
  }, 0);
  if (area < 0) vertices.reverse();
  const used = new Set([
    ...reservedIds,
    ...profile.outer.map((item) => item.id),
    ...profile.holes.map((item) => item.id),
  ]);
  return {
    outer: vertices.map((start, index) => ({
      id: nextId(used, 'edge'),
      name: `Edge ${index + 1}`,
      kind: 'line',
      start,
      end: copyPoint(vertices[(index + 1) % vertices.length]),
    })) as Profile['outer'],
    holes: structuredClone(profile.holes),
  };
}

export function rectangleSketchLoop(
  profile: Profile,
  a: Point2,
  b: Point2,
  reservedIds: string[],
): Profile {
  const left = Math.min(a[0], b[0]),
    right = Math.max(a[0], b[0]);
  const bottom = Math.min(a[1], b[1]),
    top = Math.max(a[1], b[1]);
  return replaceSketchLoop(
    profile,
    [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
    ],
    reservedIds,
  );
}

export function addSketchHole(
  profile: Profile,
  center: Point2,
  radius: number,
  reservedIds: string[],
): Profile {
  if (profile.holes.length >= 16) throw new Error('A profile supports at most 16 circular holes.');
  if (!validPoint(center) || !Number.isFinite(radius) || radius <= 0 || radius > 1000)
    throw new Error('Enter a finite center and a positive radius at most 1,000 m.');
  const used = new Set([
    ...reservedIds,
    ...profile.outer.map((item) => item.id),
    ...profile.holes.map((item) => item.id),
  ]);
  const next = structuredClone(profile);
  next.holes.push({
    id: nextId(used, 'hole'),
    name: `Circular hole ${next.holes.length + 1}`,
    center: copyPoint(center),
    radius,
  });
  return next;
}

/** Exact capsule outline: tangent straight sides and two semicircular ends. */
export function slotSketchLoop(
  profile: Profile,
  a: Point2,
  b: Point2,
  radius: number,
  reservedIds: string[],
): Profile {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (
    !validPoint(a) ||
    !validPoint(b) ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius > 1000 ||
    !(length > 0)
  )
    throw new Error(
      'A slot needs distinct finite end centers and a positive radius at most 1,000 m.',
    );
  const n: Point2 = [(-(b[1] - a[1]) / length) * radius, ((b[0] - a[0]) / length) * radius];
  const point = (center: Point2, sign: number): Point2 => [
    center[0] + sign * n[0],
    center[1] + sign * n[1],
  ];
  const points = [point(a, -1), point(b, -1), point(b, 1), point(a, 1)];
  if (
    !points.every(validPoint) ||
    [a, b].some((center) => center.some((value) => Math.abs(value) + radius > 1000))
  )
    throw new Error('Slot extents must stay within ±1,000 m.');
  const next = replaceSketchLoop(profile, points, reservedIds);
  next.outer[0].name = 'Lower straight side';
  next.outer[1] = {
    ...next.outer[1],
    name: 'End arc',
    kind: 'arc',
    center: copyPoint(b),
    clockwise: false,
  };
  next.outer[2].name = 'Upper straight side';
  next.outer[3] = {
    ...next.outer[3],
    name: 'Start arc',
    kind: 'arc',
    center: copyPoint(a),
    clockwise: false,
  };
  return next;
}
