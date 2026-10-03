import type { Project } from '../contracts/types';
import { resultIsCurrent } from '../execution/presentation';
import {
  numericArray,
  type Field,
  type FieldId,
  type FieldSource,
  type ResultData,
} from './fields';
import type { Probe } from './probe';

export interface ResultFieldSelection {
  data: ResultData;
  field: Field;
  fieldId: FieldId;
  source: FieldSource;
}

// This identity remains local. Only inspectResultField's scalar output may be
// supplied outside the result owner; arrays and buffers are never serialized.
export interface OwnedResultProbe {
  selection: ResultFieldSelection;
  probe: Probe;
}

export interface ResultInspection {
  jobId: string;
  fingerprint: string;
  fieldId: FieldId;
  source: FieldSource;
  field: {
    label: string;
    units: string;
    association: 'node' | 'cell';
    minimum: number;
    maximum: number;
    finiteCount: number;
  };
  probe: {
    association: 'node' | 'cell';
    index: number;
    value: number;
    units: string;
    position: [number, number, number];
    positionUnits: 'm';
    region: string;
  } | null;
}

export function sameResultSelection(
  first: ResultFieldSelection,
  second: ResultFieldSelection | null,
): boolean {
  return (
    !!second &&
    first.data === second.data &&
    first.field === second.field &&
    first.fieldId === second.fieldId &&
    first.source === second.source
  );
}

const boundedText = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum;

function inspectProbe(
  selection: ResultFieldSelection,
  owned: OwnedResultProbe | null,
): ResultInspection['probe'] {
  if (!owned || !sameResultSelection(owned.selection, selection)) return null;
  const { field, data } = selection;
  const { probe } = owned;
  if (
    probe.association !== field.association ||
    probe.units !== field.units ||
    !Number.isSafeInteger(probe.id) ||
    probe.id < 0 ||
    probe.id >= field.values.length ||
    !Number.isFinite(probe.value) ||
    probe.value !== field.values[probe.id] ||
    !Array.isArray(probe.position) ||
    probe.position.length !== 3 ||
    !probe.position.every(Number.isFinite) ||
    !boundedText(probe.region, 128)
  )
    return null;
  // Picking uses undeformed SI node positions and element centroids. Verify
  // the location against those arrays so an old/deformed point cannot acquire
  // a newly selected scalar merely because the scalar values happen to match.
  const position: [number, number, number] = [0, 0, 0];
  try {
    const descriptor = data.manifest.arrays.positions;
    if (
      !descriptor ||
      descriptor.dtype !== 'float64' ||
      descriptor.units !== 'm' ||
      descriptor.association !== 'node' ||
      descriptor.shape[0] !== data.manifest.statistics.nodes ||
      descriptor.shape[1] !== 3
    )
      return null;
    const positions = numericArray(data, 'positions');
    if (positions.length !== 3 * data.manifest.statistics.nodes) return null;
    if (field.association === 'node') {
      for (let axis = 0; axis < 3; axis++) position[axis] = positions[3 * probe.id + axis];
    } else {
      const descriptor = data.manifest.arrays.cells;
      const width = data.manifest.dimension === '2d' ? 3 : 4;
      if (
        !descriptor ||
        descriptor.dtype !== 'uint32' ||
        descriptor.shape[0] !== data.manifest.statistics.cells ||
        descriptor.shape[1] !== width
      )
        return null;
      const cells = numericArray(data, 'cells');
      for (let corner = 0; corner < width; corner++) {
        const node = cells[probe.id * width + corner];
        if (!Number.isSafeInteger(node) || node < 0 || 3 * node + 2 >= positions.length)
          return null;
        for (let axis = 0; axis < 3; axis++) position[axis] += positions[3 * node + axis] / width;
      }
    }
  } catch {
    return null;
  }
  if (
    !position.every(Number.isFinite) ||
    position.some((value, axis) => value !== probe.position[axis])
  )
    return null;
  return {
    association: probe.association,
    index: probe.id,
    value: probe.value,
    units: probe.units,
    position,
    positionUnits: 'm',
    region: probe.region,
  };
}

// This is a bounded inspection of the selected authoritative field, not a
// scientific verification or an inference from deformation/contour pixels.
export function inspectResultField(
  project: Project,
  selection: ResultFieldSelection | null,
  ownedProbe: OwnedResultProbe | null,
): ResultInspection | null {
  if (
    !selection ||
    !resultIsCurrent(project, selection.data) ||
    selection.fieldId === 'geometry' ||
    selection.data.manifest.operation === 'mesh'
  )
    return null;
  const { data, field, fieldId, source } = selection;
  const count =
    field.association === 'node' ? data.manifest.statistics.nodes : data.manifest.statistics.cells;
  if (
    !boundedText(data.manifest.jobId, 128) ||
    !/^[a-f0-9]{64}$/.test(data.manifest.fingerprint) ||
    (field.association !== 'node' && field.association !== 'cell') ||
    !boundedText(field.label, 256) ||
    !boundedText(field.units, 32) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    field.values.length !== count ||
    !Number.isFinite(field.minimum) ||
    !Number.isFinite(field.maximum) ||
    field.minimum > field.maximum
  )
    return null;
  let finiteCount = 0;
  for (const value of field.values) if (Number.isFinite(value)) finiteCount++;
  return {
    jobId: data.manifest.jobId,
    fingerprint: data.manifest.fingerprint,
    fieldId,
    source,
    field: {
      label: field.label,
      units: field.units,
      association: field.association,
      minimum: field.minimum,
      maximum: field.maximum,
      finiteCount,
    },
    probe: inspectProbe(selection, ownedProbe),
  };
}
