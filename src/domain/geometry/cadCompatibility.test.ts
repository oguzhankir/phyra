import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import { assertCadNumericalGeometry } from './cadCompatibility';

describe('bounded exact CAD numerical projection receipts', () => {
  it('accepts current primitive and exact profile contracts without changing their SI values', () => {
    for (const id of ['cantilever', 'cylinder', 'kirsch-quarter'] as const) {
      const geometry = makeProject(id).geometry,
        before = structuredClone(geometry);
      expect(() => assertCadNumericalGeometry(geometry)).not.toThrow();
      expect(geometry).toEqual(before);
    }
  });
  it('rejects nonfinite dimensions, extra paths, missing profiles and malformed coordinates before scientific editors consume them', () => {
    const solid = makeProject().geometry;
    for (const invalid of [
      { ...solid, length: Infinity },
      { ...solid, radius: NaN },
      { ...solid, width: 1001 },
      { ...solid, path: '/untrusted' },
      { ...solid, kind: 'profile' },
    ])
      expect(() => assertCadNumericalGeometry(invalid)).toThrow('CAD');
    const profile = makeProject('kirsch-quarter').geometry;
    profile.profile!.outer[0].start = [0, Infinity];
    expect(() => assertCadNumericalGeometry(profile)).toThrow('CAD');
    const arc = makeProject('kirsch-quarter').geometry;
    delete arc.profile!.outer[1].center;
    expect(() => assertCadNumericalGeometry(arc)).toThrow('CAD');
  });
});
