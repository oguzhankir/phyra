import type { SurfaceData } from './surface';
import type { Constraint, Load, Project } from '../../domain/contracts/types';
import type { RegionId } from '../../domain/project/regions';
import { displayValue, formatValue } from '../../domain/units';
import { tractionGlyph } from './traction';

type Vector = [number, number, number];
export type BoundaryAnchor = { region: RegionId; point: Vector; normal: Vector };
export const supportColor = '#367f72';
export const loadColor = '#bb712e';

function boundaryFacet(data: SurfaceData, index: number): BoundaryAnchor | null {
  const edges = !!data.boundaryEdges;
  const indices = data.boundaryEdges ?? data.triangles;
  const mapping = data.edgeRegions ?? data.regions;
  const width = edges ? 2 : 3;
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
}

/** Pick a real boundary facet near its mean, so a curved face's label stays on the boundary. */
export function boundaryAnchors(data: SurfaceData): BoundaryAnchor[] {
  const mapping = data.edgeRegions ?? data.regions;
  const groups = new Map<
    RegionId,
    { sum: Vector; count: number; closest?: BoundaryAnchor; distance: number }
  >();
  // Two passes keep temporary memory bounded by the number of semantic regions.
  for (let index = 0; index < mapping.length; index++) {
    const anchor = boundaryFacet(data, index);
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
    const anchor = boundaryFacet(data, index);
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

/** A bounded set of spatially separated real facets for distributed-load symbols.
 * Greedy farthest-point sampling keeps memory proportional to semantic boundaries.
 */
export function boundaryGlyphAnchors(data: SurfaceData): Map<RegionId, BoundaryAnchor[]> {
  const groups = new Map(boundaryAnchors(data).map((anchor) => [anchor.region, [anchor]]));
  const mapping = data.edgeRegions ?? data.regions;
  for (let sample = 1; sample < 3; sample++) {
    const candidates = new Map<RegionId, { anchor: BoundaryAnchor; distance: number }>();
    for (let facet = 0; facet < mapping.length; facet++) {
      const anchor = boundaryFacet(data, facet);
      if (!anchor) continue;
      const chosen = groups.get(anchor.region)!;
      const distance = Math.min(
        ...chosen.map((item) =>
          Math.hypot(...item.point.map((value, axis) => value - anchor.point[axis])),
        ),
      );
      if (distance > (candidates.get(anchor.region)?.distance ?? 0))
        candidates.set(anchor.region, { anchor, distance });
    }
    for (const [region, candidate] of candidates) groups.get(region)!.push(candidate.anchor);
  }
  return groups;
}

export function supportSummary(
  item: Constraint,
  dimension: Project['study']['dimension'],
  units: Project['displayUnits'] = 'm',
) {
  const axes = (dimension === '2d' ? ['X', 'Y'] : ['X', 'Y', 'Z']).filter(
    (_, index) => item.components[index] !== null,
  );
  const prescribed = item.components.some(
    (value, axis) => axis < (dimension === '2d' ? 2 : 3) && value !== null && value !== 0,
  );
  if (prescribed) {
    const values = (dimension === '2d' ? ['X', 'Y'] : ['X', 'Y', 'Z']).flatMap((axis, index) => {
      const component = item.components[index];
      if (component === null) return [];
      const value = displayValue(component, 'm', units);
      return [`${axis} ${formatValue(value.value)} ${value.units}`];
    });
    return `Displacement · ${values.join(', ')}`;
  }
  return `${prescribed ? 'Displacement' : axes.length === (dimension === '2d' ? 2 : 3) ? 'Fixed' : 'Restraint'} · ${axes.join(', ') || 'unassigned'}`;
}

export function loadSummary(
  item: Load,
  dimension: Project['study']['dimension'],
  anchor?: BoundaryAnchor,
) {
  if (item.kind === 'force')
    return `Force · ${formatValue(Math.hypot(...item.vector.slice(0, dimension === '2d' ? 2 : 3)))} N`;
  if (item.kind === 'pressure') {
    const pressure = displayValue(item.pressure, 'Pa', 'm');
    return `Pressure · ${formatValue(pressure.value)} ${pressure.units}`;
  }
  const vector = anchor
    ? tractionGlyph(
        item.traction,
        anchor.point[0],
        anchor.point[1],
        anchor.normal[0],
        anchor.normal[1],
      )
    : null;
  if (!vector) return `${item.traction?.kind === 'kirsch' ? 'Kirsch' : 'Affine'} traction`;
  const traction = displayValue(Math.hypot(...vector), 'Pa', 'm');
  return `Traction · ${formatValue(traction.value)} ${traction.units} here`;
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
