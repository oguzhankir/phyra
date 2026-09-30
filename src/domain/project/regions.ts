import type { Project, Constraint } from '../contracts/types';

export type RegionId = Project['study']['loads'][number]['regions'][number];
export function regionNames(
  kind: Project['geometry']['kind'],
  dimension: '2d' | '3d' = '3d',
): { id: RegionId; name: string }[] {
  if (dimension === '2d')
    return [
      { id: 'x0', name: 'Left edge · X−' },
      { id: 'x1', name: 'Right edge · X+' },
      { id: 'y0', name: 'Bottom edge · Y−' },
      { id: 'y1', name: 'Top edge · Y+' },
    ];
  if (kind === 'cylinder')
    return [
      { id: 'x0', name: 'Start cap · X−' },
      { id: 'x1', name: 'End cap · X+' },
      { id: 'outer', name: 'Curved wall' },
    ];
  const planar: { id: RegionId; name: string }[] = [
    { id: 'x0', name: 'X− boundary' },
    { id: 'x1', name: 'X+ boundary' },
    { id: 'y0', name: 'Y− boundary' },
    { id: 'y1', name: 'Y+ boundary' },
    { id: 'z0', name: 'Z− boundary' },
    { id: 'z1', name: 'Z+ boundary' },
  ];
  return kind === 'bracket'
    ? [
        ...planar,
        { id: 'inner-x', name: 'Inner X boundary' },
        { id: 'inner-y', name: 'Inner Y boundary' },
      ]
    : planar;
}

export function assignedRegions(values: RegionId[], fallback: RegionId): Constraint['regions'] {
  return values.length ? [values[0], ...values.slice(1)] : [fallback];
}
