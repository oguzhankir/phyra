import type { Manifest, Project } from './types';

export type FieldId =
  | 'geometry'
  | 'displacement-mag'
  | 'displacement-x'
  | 'displacement-y'
  | 'displacement-z'
  | 'vonMises'
  | 'stress-xx'
  | 'stress-yy'
  | 'stress-zz'
  | 'stress-xy'
  | 'stress-yz'
  | 'stress-xz'
  | 'reactions-mag'
  | 'reactions-x'
  | 'reactions-y'
  | 'reactions-z';
export type ResultData = { manifest: Manifest; buffer: ArrayBuffer };
export type Field = {
  values: Float64Array;
  association: 'node' | 'cell';
  label: string;
  units: string;
  minimum: number;
  maximum: number;
};
export const fieldOptions: { id: FieldId; label: string }[] = [
  { id: 'geometry', label: 'Geometry / boundary regions' },
  { id: 'displacement-mag', label: 'Displacement · magnitude' },
  { id: 'displacement-x', label: 'Displacement · X' },
  { id: 'displacement-y', label: 'Displacement · Y' },
  { id: 'displacement-z', label: 'Displacement · Z' },
  { id: 'vonMises', label: 'Stress · von Mises' },
  ...(['xx', 'yy', 'zz', 'xy', 'yz', 'xz'] as const).map((component) => ({
    id: `stress-${component}` as FieldId,
    label: `Stress · ${component.toUpperCase()}`,
  })),
  ...(['mag', 'x', 'y', 'z'] as const).map((component) => ({
    id: `reactions-${component}` as FieldId,
    label: `Reaction · ${component === 'mag' ? 'magnitude' : component.toUpperCase()}`,
  })),
];

export function numericArray(data: ResultData, name: string): Float64Array | Uint32Array {
  const descriptor = data.manifest.arrays[name];
  if (!descriptor) throw new Error(`Missing numerical array: ${name}`);
  const bytes = descriptor.dtype === 'float64' ? 8 : 4;
  if (
    descriptor.offset % bytes !== 0 ||
    descriptor.byteLength % bytes !== 0 ||
    descriptor.offset + descriptor.byteLength > data.buffer.byteLength
  )
    throw new Error(`Invalid array layout: ${name}`);
  return descriptor.dtype === 'float64'
    ? new Float64Array(data.buffer, descriptor.offset, descriptor.byteLength / bytes)
    : new Uint32Array(data.buffer, descriptor.offset, descriptor.byteLength / bytes);
}

export function range(values: ArrayLike<number>): [number, number] {
  if (!values.length) return [0, 0];
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let i = 0; i < values.length; i++) {
    minimum = Math.min(minimum, values[i]);
    maximum = Math.max(maximum, values[i]);
  }
  return [minimum, maximum];
}

export function vectorValues(
  values: ArrayLike<number>,
  component: 'mag' | 'x' | 'y' | 'z',
): Float64Array {
  const result = new Float64Array(values.length / 3);
  const offset = component === 'x' ? 0 : component === 'y' ? 1 : 2;
  for (let i = 0; i < result.length; i++)
    result[i] =
      component === 'mag'
        ? Math.hypot(values[3 * i], values[3 * i + 1], values[3 * i + 2])
        : values[3 * i + offset];
  return result;
}

export function extractField(data: ResultData | null, id: FieldId): Field | null {
  if (!data || id === 'geometry' || data.manifest.operation !== 'solve') return null;
  let values: Float64Array;
  let association: 'node' | 'cell' = 'node';
  let units = 'm';
  if (id === 'vonMises') {
    values = numericArray(data, 'vonMises') as Float64Array;
    association = 'cell';
    units = 'Pa';
  } else if (id.startsWith('stress-')) {
    const source = numericArray(data, 'stress');
    const component = ['xx', 'yy', 'zz', 'xy', 'yz', 'xz'].indexOf(id.slice(7));
    values = new Float64Array(source.length / 6);
    for (let i = 0; i < values.length; i++) values[i] = source[i * 6 + component];
    association = 'cell';
    units = 'Pa';
  } else {
    const reaction = id.startsWith('reactions-');
    values = vectorValues(
      numericArray(data, reaction ? 'reactions' : 'displacement'),
      id.split('-')[1] as 'mag' | 'x' | 'y' | 'z',
    );
    units = reaction ? 'N' : 'm';
  }
  const [minimum, maximum] = range(values);
  return {
    values,
    association,
    units,
    label: fieldOptions.find((option) => option.id === id)?.label ?? id,
    minimum,
    maximum,
  };
}

export function deformationScale(
  displacement: ArrayLike<number> | null,
  length: number,
  mode: 'off' | 'actual' | 'auto' | 'custom',
  custom: number,
): number {
  if (mode === 'off' || !displacement) return 0;
  if (mode === 'actual') return 1;
  if (mode === 'custom') return Math.max(0, custom);
  let maximum = 0;
  for (let i = 0; i < displacement.length; i += 3)
    maximum = Math.max(
      maximum,
      Math.hypot(displacement[i], displacement[i + 1], displacement[i + 2]),
    );
  return maximum > 0 ? (0.12 * length) / maximum : 1;
}

export function normalizedValue(value: number, minimum: number, maximum: number): number {
  return maximum > minimum
    ? Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)))
    : 0.5;
}

export function lengthFactor(units: Project['displayUnits']): number {
  return units === 'mm' ? 1000 : 1;
}
export function displayValue(
  value: number,
  units: string,
  displayUnits: Project['displayUnits'],
): { value: number; units: string } {
  if (units === 'm') return { value: value * lengthFactor(displayUnits), units: displayUnits };
  if (units === 'Pa') return { value: value / 1e6, units: 'MPa' };
  return { value, units };
}
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return Math.abs(value) < 0.001 || Math.abs(value) >= 100000
    ? value.toExponential(3)
    : new Intl.NumberFormat('en', { maximumSignificantDigits: 5 }).format(value);
}
export type RegionId = Project['study']['loads'][number]['regions'][number];
export function regionNames(kind: Project['geometry']['kind']): { id: RegionId; name: string }[] {
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
