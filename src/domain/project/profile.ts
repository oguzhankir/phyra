import type { Profile, ProfileSegment, Point2 } from '../contracts/project.generated';

type Point = readonly [number, number];
const tau = 2 * Math.PI;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point2 => [a[0] - b[0], a[1] - b[1]];
const positiveAngle = (angle: number) => ((angle % tau) + tau) % tau;

export function arcSweep(segment: ProfileSegment): number {
  const center = segment.center!;
  const first = Math.atan2(segment.start[1] - center[1], segment.start[0] - center[0]);
  const last = Math.atan2(segment.end[1] - center[1], segment.end[0] - center[0]);
  return segment.clockwise ? -positiveAngle(first - last) : positiveAngle(last - first);
}
function arcFraction(segment: ProfileSegment, point: Point): number {
  const center = segment.center!;
  const first = Math.atan2(segment.start[1] - center[1], segment.start[0] - center[0]);
  const angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
  const traveled = segment.clockwise ? positiveAngle(first - angle) : positiveAngle(angle - first);
  return traveled / Math.abs(arcSweep(segment));
}
function onSegment(segment: ProfileSegment, point: Point, tolerance: number): boolean {
  if (segment.kind === 'arc')
    return (
      distance(point, segment.start) <= tolerance ||
      distance(point, segment.end) <= tolerance ||
      (Math.abs(distance(point, segment.center!) - distance(segment.start, segment.center!)) <=
        tolerance &&
        arcFraction(segment, point) <= 1 + tolerance / distance(segment.start, segment.center!))
    );
  const delta = subtract(segment.end, segment.start);
  const relative = subtract(point, segment.start);
  const length = distance(segment.start, segment.end);
  const dot = relative[0] * delta[0] + relative[1] * delta[1];
  return (
    Math.abs(cross(delta, relative)) <= tolerance * length &&
    dot >= -tolerance * length &&
    dot <= length * length + tolerance * length
  );
}
function intersections(a: ProfileSegment, b: ProfileSegment, tolerance: number): Point2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const da = subtract(a.end, a.start),
      db = subtract(b.end, b.start);
    const denominator = cross(da, db);
    if (
      Math.abs(denominator) <=
      tolerance * Math.max(distance(a.start, a.end), distance(b.start, b.end))
    )
      return [a.start, a.end, b.start, b.end].filter(
        (point) => onSegment(a, point, tolerance) && onSegment(b, point, tolerance),
      );
    const fraction = cross(subtract(b.start, a.start), db) / denominator;
    const point: Point2 = [a.start[0] + fraction * da[0], a.start[1] + fraction * da[1]];
    return onSegment(a, point, tolerance) && onSegment(b, point, tolerance) ? [point] : [];
  }
  if (a.kind === 'arc' && b.kind === 'line') return intersections(b, a, tolerance);
  if (a.kind === 'line') {
    const center = b.center!,
      d = subtract(a.end, a.start),
      f = subtract(a.start, center);
    const radius = distance(b.start, center);
    const aa = d[0] ** 2 + d[1] ** 2,
      bb = 2 * (f[0] * d[0] + f[1] * d[1]);
    const discriminant = bb ** 2 - 4 * aa * (f[0] ** 2 + f[1] ** 2 - radius ** 2);
    if (discriminant < -(tolerance ** 2) * aa) return [];
    return [
      (-bb - Math.sqrt(Math.max(0, discriminant))) / (2 * aa),
      (-bb + Math.sqrt(Math.max(0, discriminant))) / (2 * aa),
    ]
      .map((fraction): Point2 => [a.start[0] + fraction * d[0], a.start[1] + fraction * d[1]])
      .filter((point) => onSegment(a, point, tolerance) && onSegment(b, point, tolerance));
  }
  const ca = a.center!,
    cb = b.center!,
    ra = distance(a.start, ca),
    rb = distance(b.start, cb),
    d = distance(ca, cb);
  if (d <= tolerance && Math.abs(ra - rb) <= tolerance)
    return [a.start, a.end, b.start, b.end].filter(
      (point) => onSegment(a, point, tolerance) && onSegment(b, point, tolerance),
    );
  if (d <= tolerance || d > ra + rb + tolerance || d < Math.abs(ra - rb) - tolerance) return [];
  const along = (ra ** 2 - rb ** 2 + d ** 2) / (2 * d),
    height = Math.sqrt(Math.max(0, ra ** 2 - along ** 2));
  const dx = (cb[0] - ca[0]) / d,
    dy = (cb[1] - ca[1]) / d;
  return [-1, 1]
    .map((sign): Point2 => [
      ca[0] + along * dx - sign * height * dy,
      ca[1] + along * dy + sign * height * dx,
    ])
    .filter((point) => onSegment(a, point, tolerance) && onSegment(b, point, tolerance));
}
function boundaryDistance(segment: ProfileSegment, point: Point): number {
  if (segment.kind === 'line') {
    const d = subtract(segment.end, segment.start),
      f = subtract(point, segment.start);
    const t = Math.max(0, Math.min(1, (d[0] * f[0] + d[1] * f[1]) / (d[0] ** 2 + d[1] ** 2)));
    return distance(point, [segment.start[0] + t * d[0], segment.start[1] + t * d[1]]);
  }
  const center = segment.center!,
    radius = distance(segment.start, center),
    d = distance(point, center);
  if (d === 0) return radius;
  const projected: Point2 = [
    center[0] + (radius * (point[0] - center[0])) / d,
    center[1] + (radius * (point[1] - center[1])) / d,
  ];
  return arcFraction(segment, projected) <= 1
    ? Math.abs(d - radius)
    : Math.min(distance(point, segment.start), distance(point, segment.end));
}
function inside(outer: Profile['outer'], point: Point): boolean {
  let winding = 0;
  for (const segment of outer) {
    if (segment.kind === 'line') {
      if (
        (segment.start[1] <= point[1] && segment.end[1] > point[1]) ||
        (segment.end[1] <= point[1] && segment.start[1] > point[1])
      ) {
        const x =
          segment.start[0] +
          ((point[1] - segment.start[1]) * (segment.end[0] - segment.start[0])) /
            (segment.end[1] - segment.start[1]);
        if (x > point[0]) winding += segment.end[1] > segment.start[1] ? 1 : -1;
      }
    } else {
      const center = segment.center!,
        radius = distance(segment.start, center),
        y = point[1] - center[1];
      if (Math.abs(y) >= radius) continue;
      const offset = Math.sqrt(radius ** 2 - y ** 2);
      for (const dx of [-offset, offset]) {
        const p: Point2 = [center[0] + dx, point[1]],
          fraction = arcFraction(segment, p);
        if (p[0] > point[0] && fraction >= 0 && fraction < 1)
          winding += (segment.clockwise ? -1 : 1) * Math.sign(dx);
      }
    }
  }
  return winding !== 0;
}

/** Exact segment/circle tests; sampling below is only for the viewport preview. */
export function profileError(profile: Profile | undefined): string | null {
  if (
    !profile ||
    profile.outer.length < 2 ||
    profile.outer.length > 64 ||
    profile.holes.length > 16
  )
    return 'A profile needs one closed outer loop of 2–64 line/arc edges and at most 16 circular holes.';
  const boundaries = [...profile.outer, ...profile.holes];
  if (
    boundaries.some(
      (item) =>
        !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(item.id) ||
        !item.name.trim() ||
        item.name.length > 200,
    )
  )
    return 'Each profile boundary needs a name and an ID starting with a letter, using only letters, digits, _ or −.';
  if (new Set(boundaries.map((item) => item.id)).size !== boundaries.length)
    return 'Profile boundary IDs must be unique; rename the duplicate ID and explicitly repair its assignments.';
  const points = profile.outer.flatMap((segment) => [
    segment.start,
    segment.end,
    ...(segment.center ? [segment.center] : []),
  ]);
  points.push(...profile.holes.map((hole) => hole.center));
  if (
    points.some(
      (point) =>
        point.length !== 2 ||
        point.some((value) => !Number.isFinite(value) || Math.abs(value) > 1000),
    )
  )
    return 'Profile coordinates must be finite X/Y values within ±1,000 m.';
  for (let i = 0; i < profile.outer.length; i++) {
    const segment = profile.outer[i],
      next = profile.outer[(i + 1) % profile.outer.length];
    if (segment.end[0] !== next.start[0] || segment.end[1] !== next.start[1])
      return `The outer loop is open between ${segment.name} and ${next.name}. Match the endpoints.`;
    if (segment.kind === 'arc' && (!segment.center || typeof segment.clockwise !== 'boolean'))
      return `Arc ${segment.name} needs a center and direction.`;
  }
  for (const hole of profile.holes)
    if (!(hole.radius > 0 && hole.radius <= 1000 && Number.isFinite(hole.radius)))
      return `Hole ${hole.name} needs a finite positive radius.`;
  // Match the worker's geometry normalization: tolerance belongs to the domain
  // extent, independently of SI length scale and distance from the origin.
  const bounds = profile.outer.flatMap((segment) => {
    const extrema: Point2[] = [segment.start, segment.end];
    if (segment.kind === 'arc') {
      const center = segment.center!,
        radius = distance(segment.start, center);
      for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        const point: Point2 = [
          center[0] + radius * Math.cos(angle),
          center[1] + radius * Math.sin(angle),
        ];
        if (arcFraction(segment, point) <= 1 + 1e-10) extrema.push(point);
      }
    }
    return extrema;
  });
  const low: Point2 = [
    Math.min(...bounds.map((point) => point[0])),
    Math.min(...bounds.map((point) => point[1])),
  ];
  const extents: Point2 = [
    Math.max(...bounds.map((point) => point[0])) - low[0],
    Math.max(...bounds.map((point) => point[1])) - low[1],
  ];
  const scale = Math.max(...extents);
  if (!Number.isFinite(scale) || scale < 1e-90 || Math.min(...extents) / scale < 1e-6)
    return 'Profile extent is too small or thin for float64 geometry.';
  const normalize = (point: Point2): Point2 => [
    (point[0] - low[0]) / scale,
    (point[1] - low[1]) / scale,
  ];
  profile = {
    outer: profile.outer.map((segment) => ({
      ...segment,
      start: normalize(segment.start),
      end: normalize(segment.end),
      ...(segment.center ? { center: normalize(segment.center) } : {}),
    })) as Profile['outer'],
    holes: profile.holes.map((hole) => ({
      ...hole,
      center: normalize(hole.center),
      radius: hole.radius / scale,
    })),
  };
  const tolerance = 1e-10;
  let twiceArea = 0;
  for (let i = 0; i < profile.outer.length; i++) {
    const segment = profile.outer[i],
      next = profile.outer[(i + 1) % profile.outer.length];
    if (distance(segment.start, segment.end) <= 1e-8)
      return `Boundary ${segment.name} is degenerate. Use distinct endpoints.`;
    if (segment.end[0] !== next.start[0] || segment.end[1] !== next.start[1])
      return `The outer loop is open between ${segment.name} and ${next.name}. Match the endpoints.`;
    if (segment.kind === 'arc') {
      if (!segment.center || typeof segment.clockwise !== 'boolean')
        return `Arc ${segment.name} needs a center and direction.`;
      const radius = distance(segment.start, segment.center);
      if (radius <= 1e-8 || Math.abs(radius - distance(segment.end, segment.center)) > tolerance)
        return `Arc ${segment.name} endpoints must have the same positive distance from its center.`;
      if (Math.abs(arcSweep(segment)) > Math.PI + 1e-10)
        return `Arc ${segment.name} exceeds 180°. Split it into arcs of at most 180° with distinct boundary IDs.`;
      twiceArea +=
        segment.center[0] * (segment.end[1] - segment.start[1]) -
        segment.center[1] * (segment.end[0] - segment.start[0]) +
        radius ** 2 * arcSweep(segment);
    } else twiceArea += cross(segment.start, segment.end);
  }
  for (let i = 0; i < profile.outer.length; i++)
    for (let j = i + 1; j < profile.outer.length; j++) {
      const a = profile.outer[i],
        b = profile.outer[j];
      const shared =
        profile.outer.length === 2
          ? [a.start, a.end]
          : j === i + 1
            ? [a.end]
            : i === 0 && j === profile.outer.length - 1
              ? [a.start]
              : [];
      if (
        intersections(a, b, tolerance).some(
          (point) => !shared.some((endpoint) => distance(point, endpoint) <= tolerance),
        )
      )
        return `Outer boundaries ${a.name} and ${b.name} intersect or overlap. Keep a simple loop.`;
    }
  if (twiceArea <= 0)
    return 'The outer loop must enclose a positive area in counterclockwise order.';
  if (
    twiceArea / 2 - profile.holes.reduce((sum, hole) => sum + Math.PI * hole.radius ** 2, 0) <=
    1e-10
  )
    return 'The profile must enclose a positive solid area.';
  for (let i = 0; i < profile.holes.length; i++) {
    const hole = profile.holes[i];
    if (!(hole.radius > 1e-8 && hole.radius <= 1000 && Number.isFinite(hole.radius)))
      return `Hole ${hole.name} needs a finite positive radius.`;
    if (
      !inside(profile.outer, hole.center) ||
      profile.outer.some(
        (segment) => boundaryDistance(segment, hole.center) <= hole.radius + tolerance,
      )
    )
      return `Hole ${hole.name} must lie strictly inside the outer loop without touching a boundary.`;
    for (const other of profile.holes.slice(i + 1))
      if (distance(hole.center, other.center) <= hole.radius + other.radius + tolerance)
        return `Holes ${hole.name} and ${other.name} overlap or touch.`;
  }
  return null;
}

export function sampleSegment(segment: ProfileSegment, subdivisions = 48): Point2[] {
  if (segment.kind === 'line' || !segment.center) return [segment.start, segment.end];
  const center = segment.center,
    radius = distance(segment.start, center),
    sweep = arcSweep(segment);
  const first = Math.atan2(segment.start[1] - center[1], segment.start[0] - center[0]);
  const count = Math.max(2, Math.ceil((Math.abs(sweep) * subdivisions) / tau));
  return Array.from({ length: count + 1 }, (_, i): Point2 => {
    const angle = first + (sweep * i) / count;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
}

export function rectangularProfile(length: number, width: number): Profile {
  return {
    outer: [
      { id: 'y0', name: 'Bottom edge', kind: 'line', start: [0, 0], end: [length, 0] },
      { id: 'x1', name: 'Right edge', kind: 'line', start: [length, 0], end: [length, width] },
      { id: 'y1', name: 'Top edge', kind: 'line', start: [length, width], end: [0, width] },
      { id: 'x0', name: 'Left edge', kind: 'line', start: [0, width], end: [0, 0] },
    ],
    holes: [
      {
        id: 'hole-1',
        name: 'Circular hole',
        center: [length / 2, width / 2],
        radius: Math.min(length, width) / 6,
      },
    ],
  };
}

/** Move the shared line endpoints together; identities and assignments remain owned by the profile. */
export function setArcRadius(profile: Profile, index: number, radius: number): void {
  if (!Number.isFinite(radius) || radius <= 0 || radius > 1000)
    throw new Error('Arc radius must be finite, positive, and at most 1,000 m.');
  const segment = profile.outer[index];
  if (segment.kind !== 'arc' || !segment.center) throw new Error('Select an arc with a center.');
  const center = segment.center,
    oldStart = segment.start,
    oldEnd = segment.end;
  const scale = radius / distance(oldStart, center);
  const resized = (point: Point): Point2 => [
    center[0] + (point[0] - center[0]) * scale,
    center[1] + (point[1] - center[1]) * scale,
  ];
  segment.start = resized(oldStart);
  segment.end = resized(oldEnd);
  const before = profile.outer[(index + profile.outer.length - 1) % profile.outer.length];
  const after = profile.outer[(index + 1) % profile.outer.length];
  if (before.end[0] === oldStart[0] && before.end[1] === oldStart[1])
    before.end = [...segment.start];
  if (after.start[0] === oldEnd[0] && after.start[1] === oldEnd[1]) after.start = [...segment.end];
}

export function freshBoundaryId(
  project: import('../contracts/types').Project,
  prefix: string,
): string {
  const profile = project.geometry.profile;
  const used = new Set([
    ...[...(profile?.outer ?? []), ...(profile?.holes ?? [])].map((item) => item.id),
    ...[...project.study.constraints, ...project.study.loads].flatMap((item) => item.regions),
  ]);
  let number = 1;
  while (used.has(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
}

export function changeGeometryKind(
  project: import('../contracts/types').Project,
  kind: import('../contracts/types').Project['geometry']['kind'],
): void {
  const previous = project.geometry.kind;
  if (previous === kind) return;
  project.geometry.kind = kind;
  // A box-to-profile starter retains the very same outer rectangle. Other
  // transitions have incompatible topology/coordinates and need explicit repair.
  if (!(previous === 'box' && kind === 'profile' && project.study.dimension === '2d'))
    for (const item of [...project.study.constraints, ...project.study.loads])
      item.regions.splice(0, item.regions.length);
  if (kind === 'profile') {
    project.geometry.profile = rectangularProfile(project.geometry.length, project.geometry.width);
    project.study.solver.kind = 'fem';
  } else delete project.geometry.profile;
}
