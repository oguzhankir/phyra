import { assertTrainingMetadata } from '../../domain/contracts/metadata';
import { numericArray, type ResultData } from '../../domain/results/fields';
import { regionNames } from '../../domain/project/regions';
import { selectionNameKey } from '../../domain/project/namedSelections';
import type { ArrayDescriptor, Manifest, Project } from '../../domain/contracts/types';

export type ReferenceId = '3d' | '2d-compare';
export const referenceLabels: Record<ReferenceId, string> = {
  '3d': '3D cantilever',
  '2d-compare': '2D FEM/PINN comparison',
};
const names: Record<ReferenceId, string> = {
  '3d': 'three-dimensional',
  '2d-compare': 'plane-stress-comparison',
};
type ReferenceRecord = {
  project: string;
  manifest: string;
  buffer: string;
  sha256: { project: string; manifest: string; buffer: string };
};
type ReferenceIndex = Record<ReferenceId, ReferenceRecord>;
const MAX_JSON = 512 * 1024;
const MAX_BUFFER = 16 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Saved reference is invalid: ${message}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateReferenceIndex(value: unknown): ReferenceIndex {
  ensure(record(value), 'missing reference index.');
  for (const id of ['3d', '2d-compare'] as const) {
    const item = value[id];
    ensure(record(item) && record(item.sha256), 'missing reference files or digests.');
    for (const [key, suffix] of [
      ['project', 'project.json'],
      ['manifest', 'manifest.json'],
      ['buffer', 'bin'],
    ] as const) {
      ensure(
        item[key] === `/reference/${names[id]}.${suffix}`,
        'file paths must name bundled reference assets.',
      );
      ensure(
        typeof item.sha256[key] === 'string' && hashPattern.test(item.sha256[key]),
        'invalid SHA-256 digest.',
      );
    }
  }
  return value as ReferenceIndex;
}

export async function verifyDigest(buffer: ArrayBuffer, expected: string): Promise<void> {
  ensure(hashPattern.test(expected), 'invalid SHA-256 digest.');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  ensure(actual === expected, 'file digest does not match the recorded asset.');
}

async function fetchBounded(
  path: string,
  maximum: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal });
  if (!response.ok) throw new Error(`Reference file could not be loaded (${response.status}).`);
  const declared = Number(response.headers.get('content-length'));
  ensure(!Number.isFinite(declared) || declared <= maximum, 'file exceeds the preview size limit.');
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    ensure(buffer.byteLength <= maximum, 'file exceeds the preview size limit.');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error('Reference file exceeds the preview size limit.');
    }
    chunks.push(chunk.value);
  }
  const buffer = new ArrayBuffer(length);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

function validateJsonTree(value: unknown, depth = 0, budget = { remaining: 100000 }): void {
  ensure(depth <= 12 && --budget.remaining >= 0, 'structured content exceeds the preview limits.');
  if (typeof value === 'number') ensure(Number.isFinite(value), 'nonfinite structured value.');
  else if (typeof value === 'string') ensure(value.length <= 8192, 'oversized structured string.');
  else if (Array.isArray(value)) {
    ensure(value.length <= 50000, 'oversized structured array.');
    value.forEach((item) => validateJsonTree(item, depth + 1, budget));
  } else if (record(value))
    Object.values(value).forEach((item) => validateJsonTree(item, depth + 1, budget));
}

// The immutable projects are also checked against the canonical schema in fixture tests.
// Browser validation checks ownership and all data that reaches the rendering path.
export function validateReference(
  id: ReferenceId,
  projectValue: unknown,
  manifestValue: unknown,
  buffer: ArrayBuffer,
): { project: Project; data: ResultData } {
  validateJsonTree(projectValue);
  validateJsonTree(manifestValue);
  ensure(
    record(projectValue) && record(projectValue.study) && record(projectValue.geometry),
    'missing project definition.',
  );
  const project = projectValue as unknown as Project;
  const dimension = id === '3d' ? '3d' : '2d';
  ensure(
    project.schemaVersion === 4 && project.study.dimension === dimension,
    'unsupported project version or dimension.',
  );
  ensure(
    project.displayUnits === 'm' || project.displayUnits === 'mm',
    'unsupported display unit.',
  );
  ensure(
    typeof project.id === 'string' &&
      typeof project.study.id === 'string' &&
      Number.isSafeInteger(project.revision) &&
      project.revision >= 0,
    'invalid project ownership.',
  );
  ensure(['box', 'cylinder', 'bracket'].includes(project.geometry.kind), 'unsupported geometry.');
  ensure(
    Array.isArray(project.namedSelections) && project.namedSelections.length <= 100,
    'missing or oversized boundary-set library.',
  );
  const selectionIds = new Set<string>();
  const selectionNames = new Set<string>();
  for (const selection of project.namedSelections) {
    ensure(
      record(selection) &&
        typeof selection.id === 'string' &&
        selectionNameKey(selection.id).length > 0 &&
        selection.id.length <= 100 &&
        typeof selection.name === 'string' &&
        selectionNameKey(selection.name).length > 0 &&
        selection.name.length <= 200 &&
        ['box', 'cylinder', 'bracket'].includes(selection.geometryKind) &&
        ['2d', '3d'].includes(selection.dimension) &&
        (selection.dimension !== '2d' || selection.geometryKind === 'box') &&
        Array.isArray(selection.regions) &&
        selection.regions.length > 0 &&
        selection.regions.length <= 20,
      'invalid boundary-set metadata or topology stamp.',
    );
    const name = selectionNameKey(selection.name);
    ensure(
      !selectionIds.has(selection.id) && !selectionNames.has(name),
      'duplicate boundary-set identity.',
    );
    selectionIds.add(selection.id);
    selectionNames.add(name);
    const stampedRegions = regionNames(selection.geometryKind, selection.dimension).map(
      ({ id: region }) => region,
    );
    ensure(
      new Set(selection.regions).size === selection.regions.length &&
        selection.regions.every((region) => stampedRegions.includes(region)),
      'invalid stamped boundary-set regions.',
    );
  }
  ensure(
    ['length', 'width', 'height', 'radius', 'thickness'].every((key) => {
      const value = project.geometry[key as keyof Project['geometry']];
      return typeof value === 'number' && value > 0 && value <= 1000;
    }),
    'invalid geometry dimensions.',
  );
  ensure(
    Array.isArray(project.study.constraints) && Array.isArray(project.study.loads),
    'missing boundary assignments.',
  );
  const validRegions = regionNames(project.geometry.kind, dimension).map((region) => region.id);
  for (const item of [...project.study.constraints, ...project.study.loads]) {
    ensure(
      Array.isArray(item.regions) &&
        item.regions.length > 0 &&
        item.regions.every((region) => validRegions.includes(region)),
      'invalid assigned boundary.',
    );
  }
  ensure(
    record(manifestValue) && record(manifestValue.statistics) && record(manifestValue.arrays),
    'missing result manifest.',
  );
  const manifest = manifestValue as unknown as Manifest;
  ensure(
    manifest.protocolVersion === 1 && manifest.status === 'succeeded',
    'unsupported result protocol or status.',
  );
  ensure(
    manifest.projectId === project.id &&
      manifest.studyId === project.study.id &&
      manifest.revision === project.revision,
    'project, study, or revision does not own this result.',
  );
  ensure(
    manifest.dimension === dimension && manifest.operation === (id === '3d' ? 'solve' : 'compare'),
    'result does not match the reference study.',
  );
  ensure(
    hashPattern.test(manifest.fingerprint) &&
      hashPattern.test(manifest.bufferHash) &&
      typeof manifest.jobId === 'string' &&
      manifest.jobId.length > 0,
    'missing result provenance.',
  );
  ensure(
    manifest.byteLength === buffer.byteLength && buffer.byteLength <= MAX_BUFFER,
    'binary size does not match the manifest.',
  );
  ensure(
    manifest.coordinateFrame === 'cartesian-global-SI' &&
      manifest.stressComponents.join(',') === 'xx,yy,zz,xy,yz,xz',
    'unsupported coordinate frame or stress convention.',
  );
  const counts = {
    node: manifest.statistics.nodes,
    cell: manifest.statistics.cells,
    surface: manifest.statistics.surfaceTriangles,
    edge: manifest.statistics.boundaryEdges ?? 0,
  };
  const limits = { node: 12000, cell: 50000, surface: 100000, edge: 100000 };
  ensure(
    Object.entries(counts).every(
      ([association, count]) =>
        Number.isSafeInteger(count) &&
        count >= 0 &&
        count <= limits[association as keyof typeof limits],
    ) &&
      counts.node > 0 &&
      counts.cell > 0 &&
      counts.surface > 0,
    'invalid mesh counts.',
  );
  ensure(
    Array.isArray(manifest.regions) &&
      manifest.regions.length > 0 &&
      manifest.regions.length <= 32 &&
      manifest.regions.every((region) =>
        validRegions.includes(region.id as (typeof validRegions)[number]),
      ),
    'invalid result boundary identities.',
  );
  const layout: Record<
    string,
    [ArrayDescriptor['dtype'], ArrayDescriptor['association'], string, number | null]
  > = {
    positions: ['float64', 'node', 'm', 3],
    cells: ['uint32', 'cell', '1', dimension === '3d' ? 4 : 3],
    surface: ['uint32', 'surface', '1', 3],
    surfaceRegions: ['uint32', 'surface', '1', null],
    surfaceCells: ['uint32', 'surface', '1', null],
    displacement: ['float64', 'node', 'm', 3],
    stress: ['float64', 'cell', 'Pa', 6],
    vonMises: ['float64', 'cell', 'Pa', null],
    reactions: ['float64', 'node', 'N', 3],
  };
  if (dimension === '2d') {
    layout.boundaryEdges = ['uint32', 'edge', '1', 2];
    layout.edgeRegions = ['uint32', 'edge', '1', null];
    for (const name of ['displacement', 'stress', 'vonMises', 'reactions'])
      layout[`pinn${name[0].toUpperCase()}${name.slice(1)}`] = layout[name];
  }
  ensure(
    Object.keys(manifest.arrays).length === Object.keys(layout).length,
    'unexpected numerical arrays.',
  );
  const data = { manifest, buffer };
  const spans: { start: number; end: number }[] = [];
  for (const [name, [dtype, association, units, width]] of Object.entries(layout)) {
    const descriptor = manifest.arrays[name];
    const expectedShape = width === null ? [counts[association]] : [counts[association], width];
    ensure(
      descriptor &&
        descriptor.dtype === dtype &&
        descriptor.association === association &&
        descriptor.units === units &&
        Array.isArray(descriptor.shape) &&
        descriptor.shape.join(',') === expectedShape.join(','),
      `invalid dimensions, type, association or units for ${name}.`,
    );
    const bytes = dtype === 'float64' ? 8 : 4;
    ensure(
      Number.isSafeInteger(descriptor.offset) &&
        descriptor.offset >= 0 &&
        Number.isSafeInteger(descriptor.byteLength) &&
        descriptor.byteLength === expectedShape.reduce((total, count) => total * count, bytes),
      `invalid byte layout for ${name}.`,
    );
    const array = numericArray(data, name);
    ensure(array.every(Number.isFinite), `nonfinite field values in ${name}.`);
    if (dtype === 'uint32') {
      const maximum =
        name === 'surfaceCells'
          ? counts.cell
          : name === 'surfaceRegions' || name === 'edgeRegions'
            ? manifest.regions.length
            : counts.node;
      ensure(
        array.every((value) => value < maximum),
        `out-of-bounds index in ${name}.`,
      );
    }
    spans.push({ start: descriptor.offset, end: descriptor.offset + descriptor.byteLength });
  }
  spans.sort((a, b) => a.start - b.start);
  ensure(
    spans.every((span, index) => index === 0 || span.start >= spans[index - 1].end),
    'numerical arrays overlap.',
  );
  ensure(
    manifest.summary && Array.isArray(manifest.warnings) && record(manifest.versions),
    'missing physical summary or diagnostics.',
  );
  if (id === '2d-compare') {
    ensure(
      manifest.comparison &&
        manifest.training?.device === 'cpu' &&
        manifest.training.precision === 'float64' &&
        manifest.training.history.length > 0 &&
        manifest.training.history.every((sample) => sample.jobId === manifest.jobId),
      'missing owned CPU comparison and stored training history.',
    );
  }
  assertTrainingMetadata(manifest);
  return { project, data };
}

export async function loadReference(
  id: ReferenceId,
): Promise<{ project: Project; data: ResultData }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const decoder = new TextDecoder();
    const index = validateReferenceIndex(
      JSON.parse(
        decoder.decode(await fetchBounded('/reference/index.json', 16 * 1024, controller.signal)),
      ),
    );
    const item = index[id];
    const [projectBytes, manifestBytes, buffer] = await Promise.all([
      fetchBounded(item.project, MAX_JSON, controller.signal),
      fetchBounded(item.manifest, MAX_JSON, controller.signal),
      fetchBounded(item.buffer, MAX_BUFFER, controller.signal),
    ]);
    await Promise.all([
      verifyDigest(projectBytes, item.sha256.project),
      verifyDigest(manifestBytes, item.sha256.manifest),
      verifyDigest(buffer, item.sha256.buffer),
    ]);
    const project = JSON.parse(decoder.decode(projectBytes));
    const manifest = JSON.parse(decoder.decode(manifestBytes));
    ensure(
      manifest.bufferHash === item.sha256.buffer,
      'manifest digest does not identify its binary fields.',
    );
    return validateReference(id, project, manifest, buffer);
  } catch (cause) {
    if (controller.signal.aborted)
      throw new Error('Reference loading timed out. The previous project remains unchanged.');
    throw cause;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
