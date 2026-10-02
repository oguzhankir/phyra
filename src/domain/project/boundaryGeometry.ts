import type { Project } from '../contracts/types';
import { sampleSegment } from './profile';

export type Point3 = readonly [number, number, number];

// Canonical points on supported definition boundaries. These are geometric
// anchors, not mesh nodes, quadrature points or numerical result samples.
export function boundaryPoints(project: Project, region: string): Point3[] {
  const { geometry: g, study } = project;
  if (g.kind === 'profile') {
    const segment = g.profile?.outer.find((item) => item.id === region);
    if (segment) return sampleSegment(segment, 2).map(([x, y]) => [x, y, 0]);
    const hole = g.profile?.holes.find((item) => item.id === region);
    return hole
      ? [0, 1, 2, 3].map((quarter) => [
          hole.center[0] + hole.radius * Math.cos((quarter * Math.PI) / 2),
          hole.center[1] + hole.radius * Math.sin((quarter * Math.PI) / 2),
          0,
        ])
      : [];
  }
  const { length: l, width: w, height: h, radius: r, thickness: t } = g;
  if (study.dimension === '2d') {
    const edges: Record<string, Point3[]> = {
      x0: [
        [0, 0, 0],
        [0, w, 0],
      ],
      x1: [
        [l, 0, 0],
        [l, w, 0],
      ],
      y0: [
        [0, 0, 0],
        [l, 0, 0],
      ],
      y1: [
        [0, w, 0],
        [l, w, 0],
      ],
    };
    return edges[region] ?? [];
  }
  if (g.kind === 'cylinder') {
    const ring = (x: number): Point3[] => [
      [x, r, 0],
      [x, 0, r],
      [x, -r, 0],
      [x, 0, -r],
    ];
    if (region === 'x0') return ring(0);
    if (region === 'x1') return ring(l);
    return region === 'outer' ? [...ring(0), ...ring(l)] : [];
  }
  const rectangle = (corners: Point3[]): Point3[] => corners;
  const points: Record<string, Point3[]> = {
    x0: rectangle([
      [0, 0, 0],
      [0, w, 0],
      [0, w, h],
      [0, 0, h],
    ]),
    x1: rectangle([
      [l, 0, 0],
      [l, g.kind === 'bracket' ? t : w, 0],
      [l, g.kind === 'bracket' ? t : w, h],
      [l, 0, h],
    ]),
    y0: rectangle([
      [0, 0, 0],
      [l, 0, 0],
      [l, 0, h],
      [0, 0, h],
    ]),
    y1: rectangle([
      [0, w, 0],
      [g.kind === 'bracket' ? t : l, w, 0],
      [g.kind === 'bracket' ? t : l, w, h],
      [0, w, h],
    ]),
    'inner-x': [
      [t, t, 0],
      [t, w, 0],
      [t, w, h],
      [t, t, h],
    ],
    'inner-y': [
      [t, t, 0],
      [l, t, 0],
      [l, t, h],
      [t, t, h],
    ],
  };
  if (region === 'z0' || region === 'z1') {
    const z = region === 'z0' ? 0 : h;
    return g.kind === 'bracket'
      ? [
          [0, 0, z],
          [l, 0, z],
          [l, t, z],
          [t, t, z],
          [t, w, z],
          [0, w, z],
        ]
      : [
          [0, 0, z],
          [l, 0, z],
          [l, w, z],
          [0, w, z],
        ];
  }
  return points[region] ?? [];
}

export function boundaryCenter(project: Project, region: string): Point3 | null {
  const points = boundaryPoints(project, region);
  if (!points.length) return null;
  const mean = (axis: number) =>
    points.reduce((sum, point) => sum + point[axis], 0) / points.length;
  return [mean(0), mean(1), mean(2)];
}
