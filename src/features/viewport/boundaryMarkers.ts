import type { SurfaceData } from './surface';
import type { Constraint, Load, Project } from '../../domain/contracts/types';
import type { RegionId } from '../../domain/project/regions';
import { formatValue } from '../../domain/units';

type Vector = [number, number, number];
export type BoundaryAnchor = { region: RegionId; point: Vector; normal: Vector };
export const supportColor = '#367f72';
export const loadColor = '#bb712e';

/** Pick a real boundary facet near its mean, so a curved face's label stays on the boundary. */
export function boundaryAnchors(data: SurfaceData): BoundaryAnchor[] {
  const edges = !!data.boundaryEdges;
  const indices = data.boundaryEdges ?? data.triangles;
  const mapping = data.edgeRegions ?? data.regions;
  const width = edges ? 2 : 3;
  const groups = new Map<
    RegionId,
    { sum: Vector; count: number; closest?: BoundaryAnchor; distance: number }
  >();
  const facet = (index: number): BoundaryAnchor | null => {
    const region = data.regionIds[mapping[index]];
    if (!region) return null;
    const points: Vector[] = Array.from({ length: width }, (_, corner) => {
      const node = indices[width * index + corner];
      return [data.positions[3 * node], data.positions[3 * node + 1], data.positions[3 * node + 2]];
    });
    const point = points.reduce<Vector>(
      (sum, item) => [sum[0] + item[0] / width, sum[1] + item[1] / width, sum[2] + item[2] / width],
      [0, 0, 0],
    );
    const a = points[1].map((value, axis) => value - points[0][axis]);
    const b = edges ? [0, 0, 1] : points[2].map((value, axis) => value - points[0][axis]);
    const normal: Vector = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const length = Math.hypot(...normal);
    if (!Number.isFinite(length) || length === 0) return null;
    return { region, point, normal: normal.map((value) => value / length) as Vector };
  };
  // Two passes keep temporary memory bounded by the number of semantic regions.
  for (let index = 0; index < mapping.length; index++) {
    const anchor = facet(index);
    if (!anchor) continue;
    const group = groups.get(anchor.region) ?? {
      sum: [0, 0, 0] as Vector,
      count: 0,
      distance: Infinity,
    };
    for (let axis = 0; axis < 3; axis++) group.sum[axis] += anchor.point[axis];
    group.count++;
    groups.set(anchor.region, group);
  }
  for (let index = 0; index < mapping.length; index++) {
    const anchor = facet(index);
    if (!anchor) continue;
    const group = groups.get(anchor.region)!;
    const distance = Math.hypot(
      ...anchor.point.map((value, axis) => value - group.sum[axis] / group.count),
    );
    if (distance < group.distance) {
      group.closest = anchor;
      group.distance = distance;
    }
  }
  return [...groups.values()].flatMap((group) => (group.closest ? [group.closest] : []));
}

export function supportDescription(item: Constraint, dimension: Project['study']['dimension']) {
  const axes = dimension === '2d' ? ['X', 'Y'] : ['X', 'Y', 'Z'];
  return axes
    .filter((_, index) => item.components[index] !== null)
    .map((axis) => {
      const value = item.components[axes.indexOf(axis)]!;
      return `${axis} = ${formatValue(value)} m`;
    })
    .join(' · ');
}

export function loadDescription(item: Load, dimension: Project['study']['dimension']) {
  if (item.kind === 'pressure') return `Pressure ${formatValue(item.pressure)} Pa`;
  if (item.kind === 'traction')
    return `${item.traction?.kind === 'kirsch' ? 'Kirsch' : 'Affine'} traction · Pa`;
  const axes = dimension === '2d' ? ['X', 'Y'] : ['X', 'Y', 'Z'];
  return `Force (${axes.map((_, index) => formatValue(item.vector[index])).join(', ')}) N`;
}
