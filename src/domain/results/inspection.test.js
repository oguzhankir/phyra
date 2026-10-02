import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractField, numericArray } from './fields';
import { inspectResultField, sameResultSelection } from './inspection';

// Read the actual checked-in CPU reference. These tests inspect its scalar
// fields and ownership; they introduce no synthetic solver or accuracy claim.
function reference(name = 'three-dimensional', fieldId = 'displacement-mag', source = 'primary') {
  const base = `../../../public/reference/${name}`;
  const project = JSON.parse(
    readFileSync(new URL(`${base}.project.json`, import.meta.url), 'utf8'),
  );
  const manifest = JSON.parse(
    readFileSync(new URL(`${base}.manifest.json`, import.meta.url), 'utf8'),
  );
  const bytes = readFileSync(new URL(`${base}.bin`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const data = { manifest, buffer };
  const field = extractField(data, fieldId, source);
  const selection = { data, field, fieldId, source };
  return { project, selection };
}

function ownedProbe(selection, index = 0) {
  const positions = numericArray(selection.data, 'positions');
  const position = [0, 0, 0];
  if (selection.field.association === 'node') {
    for (let axis = 0; axis < 3; axis++) position[axis] = positions[3 * index + axis];
  } else {
    const cells = numericArray(selection.data, 'cells');
    const width = selection.data.manifest.dimension === '2d' ? 3 : 4;
    for (let corner = 0; corner < width; corner++)
      for (let axis = 0; axis < 3; axis++)
        position[axis] += positions[3 * cells[index * width + corner] + axis] / width;
  }
  return {
    selection,
    probe: {
      association: selection.field.association,
      id: index,
      value: selection.field.values[index],
      units: selection.field.units,
      position,
      region: 'Interior',
    },
  };
}

describe('selected result scalar inspection', () => {
  it('reports the selected actual SI field without attaching its arrays or binary buffer', () => {
    const { project, selection } = reference();
    project.displayUnits = 'mm';
    const inspection = inspectResultField(project, selection, ownedProbe(selection));
    expect(inspection.jobId).toBe(selection.data.manifest.jobId);
    expect(inspection.fingerprint).toBe(selection.data.manifest.fingerprint);
    expect(inspection.fieldId).toBe('displacement-mag');
    expect(inspection.source).toBe('primary');
    expect(inspection.field).toEqual({
      label: selection.field.label,
      units: 'm',
      association: 'node',
      minimum: selection.field.minimum,
      maximum: selection.field.maximum,
      finiteCount: selection.field.values.length,
    });
    expect(inspection.probe).toEqual({
      association: 'node',
      index: 0,
      value: selection.field.values[0],
      units: 'm',
      position: ownedProbe(selection).probe.position,
      positionUnits: 'm',
      region: 'Interior',
    });
    expect(Object.keys(inspection)).toEqual([
      'jobId',
      'fingerprint',
      'fieldId',
      'source',
      'field',
      'probe',
    ]);
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain('buffer');
    expect(serialized).not.toContain('values');
    expect(serialized.length).toBeLessThan(1500);
  });

  it.each(['project', 'study', 'revision'])(
    'omits fields whose %s identity is no longer current',
    (identity) => {
      const { project, selection } = reference();
      if (identity === 'project') project.id = crypto.randomUUID();
      if (identity === 'study') project.study.id = crypto.randomUUID();
      if (identity === 'revision') project.revision++;
      expect(inspectResultField(project, selection, ownedProbe(selection))).toBeNull();
    },
  );

  it('omits an unavailable selection, geometry preview and mesh-only result', () => {
    const { project, selection } = reference();
    expect(inspectResultField(project, null, null)).toBeNull();
    expect(inspectResultField(project, { ...selection, fieldId: 'geometry' }, null)).toBeNull();
    selection.data.manifest.operation = 'mesh';
    expect(inspectResultField(project, selection, null)).toBeNull();
  });

  it.each(['fieldId', 'source', 'field', 'data'])(
    'cannot attribute an old probe to a changed %s even if scalar values match',
    (identity) => {
      const { project, selection } = reference();
      const old = ownedProbe(selection);
      const next = { ...selection };
      if (identity === 'fieldId') next.fieldId = 'displacement-x';
      if (identity === 'source') next.source = 'fem';
      if (identity === 'field') next.field = { ...selection.field };
      if (identity === 'data') next.data = { ...selection.data };
      expect(sameResultSelection(selection, next)).toBe(false);
      expect(inspectResultField(project, next, old)?.probe).toBeNull();
    },
  );

  it.each(['index', 'value', 'units', 'association', 'position', 'deformed-position', 'region'])(
    'omits an invalid %s without losing the valid selected field summary',
    (invalid) => {
      const { project, selection } = reference();
      const owned = ownedProbe(selection);
      if (invalid === 'index') owned.probe.id = selection.field.values.length;
      if (invalid === 'value') owned.probe.value = NaN;
      if (invalid === 'units') owned.probe.units = 'mm';
      if (invalid === 'association') owned.probe.association = 'cell';
      if (invalid === 'position') owned.probe.position[0] = Infinity;
      if (invalid === 'deformed-position') owned.probe.position[0] += 1;
      if (invalid === 'region') owned.probe.region = 'x'.repeat(129);
      const inspection = inspectResultField(project, selection, owned);
      expect(inspection?.field.units).toBe('m');
      expect(inspection?.probe).toBeNull();
    },
  );

  it('reports actual stress and the undeformed element centroid in SI', () => {
    const { project, selection } = reference('three-dimensional', 'vonMises');
    const owned = ownedProbe(selection);
    const inspection = inspectResultField(project, selection, owned);
    expect(inspection.field.units).toBe('Pa');
    expect(inspection.field.association).toBe('cell');
    expect(inspection.probe?.value).toBe(selection.field.values[0]);
    expect(inspection.probe?.position).toEqual(owned.probe.position);
    expect(inspection.probe?.positionUnits).toBe('m');
    owned.probe.position[0] += 1;
    expect(inspection.probe?.position).not.toEqual(owned.probe.position);
  });

  it('keeps relative-error units and counts defined scalar values while excluding undefined probes', () => {
    const { project, selection } = reference(
      'plane-stress-comparison',
      'displacement-mag',
      'relative',
    );
    selection.field.finiteCount = 0;
    const omitted = selection.field.values.findIndex((value) => !Number.isFinite(value));
    expect(omitted).toBeGreaterThanOrEqual(0);
    const inspection = inspectResultField(project, selection, ownedProbe(selection, omitted));
    expect(inspection.source).toBe('relative');
    expect(inspection.field.units).toBe('%');
    expect(inspection.field.finiteCount).toBe(
      Array.from(selection.field.values).filter(Number.isFinite).length,
    );
    expect(inspection.probe).toBeNull();
    expect(JSON.stringify(inspection)).not.toContain('NaN');
  });

  it.each(['label', 'units', 'fingerprint', 'count', 'range'])(
    'omits invalid or unbounded %s metadata',
    (invalid) => {
      const { project, selection } = reference();
      if (invalid === 'label') selection.field.label = 'x'.repeat(257);
      if (invalid === 'units') selection.field.units = 'x'.repeat(33);
      if (invalid === 'fingerprint') selection.data.manifest.fingerprint = 'unknown';
      if (invalid === 'count') selection.data.manifest.statistics.nodes++;
      if (invalid === 'range') selection.field.maximum = Infinity;
      expect(inspectResultField(project, selection, null)).toBeNull();
    },
  );
});
