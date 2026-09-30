import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { describe, expect, it, vi } from 'vitest';
import schema from '../../../contracts/project.schema.json';
import { extractField, numericArray } from '../../domain/results/fields';
import { presentRun, resultIsCurrent } from '../../domain/execution/presentation';
import {
  validateReference,
  validateReferenceIndex,
  verifyDigest,
  loadReference,
} from './references';

const index = validateReferenceIndex(
  JSON.parse(readFileSync('public/reference/index.json', 'utf8')),
);
const validateProject = new Ajv({ strict: true, strictTuples: false }).compile(schema);
function fixture(id) {
  const item = index[id];
  const projectBytes = readFileSync(`public${item.project}`);
  const manifestBytes = readFileSync(`public${item.manifest}`);
  const bufferBytes = readFileSync(`public${item.buffer}`);
  const project = JSON.parse(projectBytes.toString('utf8'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const buffer = Uint8Array.from(bufferBytes).buffer;
  return {
    item,
    project,
    manifest,
    buffer,
    projectBytes: Uint8Array.from(projectBytes).buffer,
    manifestBytes: Uint8Array.from(manifestBytes).buffer,
  };
}

describe('actual bundled CPU reference data', () => {
  it.each(['3d', '2d-compare'])(
    'validates %s schema, digests, owned buffers and physical fields',
    async (id) => {
      const saved = fixture(id);
      expect(validateProject(saved.project), JSON.stringify(validateProject.errors)).toBe(true);
      await verifyDigest(saved.projectBytes, saved.item.sha256.project);
      await verifyDigest(saved.manifestBytes, saved.item.sha256.manifest);
      await verifyDigest(saved.buffer, saved.item.sha256.buffer);
      expect(saved.manifest.bufferHash).toBe(saved.item.sha256.buffer);
      const result = validateReference(id, saved.project, saved.manifest, saved.buffer);
      expect(resultIsCurrent(result.project, result.data)).toBe(true);
      const displacement = extractField(result.data, 'displacement-mag');
      expect(displacement.values.every(Number.isFinite)).toBe(true);
      expect(displacement.maximum).toBe(saved.manifest.summary.maxDisplacement);
      expect(extractField(result.data, 'vonMises').maximum).toBe(
        saved.manifest.summary.maxVonMises,
      );
    },
  );
  it('rejects an altered binary even when its size is unchanged', async () => {
    const saved = fixture('3d');
    new Uint8Array(saved.buffer)[0] ^= 1;
    await expect(verifyDigest(saved.buffer, saved.item.sha256.buffer)).rejects.toThrow('digest');
  });
  it('rejects reference URLs outside the exact bundled asset paths', () => {
    const changed = structuredClone(index);
    changed['3d'].buffer = 'https://example.invalid/fields.bin';
    expect(() => validateReferenceIndex(changed)).toThrow('bundled reference assets');
  });
  it('loads only the bounded local assets and forbids redirects', async () => {
    const requests = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
      requests.push({ path, options });
      return new Response(readFileSync(`public${path}`));
    });
    try {
      const result = await loadReference('2d-compare');
      expect(result.data.manifest.operation).toBe('compare');
      expect(requests.map((request) => request.path).sort()).toEqual(
        [
          '/reference/index.json',
          index['2d-compare'].project,
          index['2d-compare'].manifest,
          index['2d-compare'].buffer,
        ].sort(),
      );
      expect(
        requests.every(
          (request) =>
            request.options.redirect === 'error' && request.options.signal instanceof AbortSignal,
        ),
      ).toBe(true);
    } finally {
      fetch.mockRestore();
    }
  });
  it('aborts a stalled response instead of holding the workbench lock indefinitely', async () => {
    vi.useFakeTimers();
    let signal;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_path, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      );
    });
    try {
      const rejected = expect(loadReference('3d')).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(15000);
      await rejected;
      expect(signal.aborted).toBe(true);
    } finally {
      fetch.mockRestore();
      vi.useRealTimers();
    }
  });
  it.each(['projectId', 'studyId', 'revision'])('rejects a different %s owner', (owner) => {
    const saved = fixture('3d');
    saved.manifest[owner] = owner === 'revision' ? saved.project.revision + 1 : 'other-owner';
    expect(() => validateReference('3d', saved.project, saved.manifest, saved.buffer)).toThrow(
      'does not own this result',
    );
  });
  it('rejects malformed shapes and out-of-buffer descriptors', () => {
    const saved = fixture('3d');
    saved.manifest.arrays.positions.shape[1] = 2;
    expect(() => validateReference('3d', saved.project, saved.manifest, saved.buffer)).toThrow(
      'dimensions',
    );
    saved.manifest.arrays.positions.shape[1] = 3;
    saved.manifest.arrays.positions.offset = saved.buffer.byteLength;
    expect(() => validateReference('3d', saved.project, saved.manifest, saved.buffer)).toThrow(
      'array layout',
    );
  });
  it('rejects overlapping fields and mesh indices outside the node table', () => {
    const saved = fixture('3d');
    const result = validateReference('3d', saved.project, saved.manifest, saved.buffer);
    const cells = numericArray(result.data, 'cells');
    cells[0] = saved.manifest.statistics.nodes;
    expect(() => validateReference('3d', saved.project, saved.manifest, saved.buffer)).toThrow(
      'out-of-bounds index',
    );
    const overlap = fixture('3d');
    overlap.manifest.arrays.displacement.offset = overlap.manifest.arrays.positions.offset;
    expect(() =>
      validateReference('3d', overlap.project, overlap.manifest, overlap.buffer),
    ).toThrow('overlap');
  });
  it('rejects nonfinite physical field values and oversized mesh counts', () => {
    const saved = fixture('3d');
    const result = validateReference('3d', saved.project, saved.manifest, saved.buffer);
    numericArray(result.data, 'displacement')[0] = NaN;
    expect(() => validateReference('3d', saved.project, saved.manifest, saved.buffer)).toThrow(
      'nonfinite field',
    );
    const oversized = fixture('3d');
    oversized.manifest.statistics.nodes = 12001;
    expect(() =>
      validateReference('3d', oversized.project, oversized.manifest, oversized.buffer),
    ).toThrow('mesh counts');
  });
  it('invalidates recorded results after physical edits and keeps their history out of a new run', () => {
    const saved = fixture('2d-compare');
    const result = validateReference('2d-compare', saved.project, saved.manifest, saved.buffer);
    const restored = presentRun(result.project, result.data.manifest, null, [], 'idle', 0);
    expect(restored.status).toBe('completed');
    expect(restored.history.at(-1)?.step).toBe(result.project.study.solver.pinn.steps);
    expect(restored.history.every((metric) => metric.jobId === result.data.manifest.jobId)).toBe(
      true,
    );
    const edited = structuredClone(result.project);
    edited.geometry.length *= 1.1;
    edited.revision++;
    expect(resultIsCurrent(edited, result.data)).toBe(false);
    const preparing = presentRun(
      edited,
      result.data.manifest,
      { project: edited, operation: 'compare' },
      [],
      'preparing',
      0,
    );
    expect(preparing.history).toEqual([]);
    expect(preparing.jobId).toBeUndefined();
    expect(preparing.manifest).toBeUndefined();
    expect(preparing.retainedJobId).toBe(result.data.manifest.jobId);
  });
});
