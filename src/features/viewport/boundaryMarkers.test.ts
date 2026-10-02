import { describe, expect, it } from 'vitest';
import { boundaryAnchors, loadDescription, supportDescription } from './boundaryMarkers';
import type { SurfaceData } from './surface';
import type { Constraint, Load } from '../../domain/contracts/types';

describe('located boundary conditions', () => {
  it('uses actual planar boundary edges and outward normals instead of an arbitrary interior triangle', () => {
    const data: SurfaceData = {
      positions: new Float64Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]),
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      regions: new Uint32Array([0, 0]),
      boundaryEdges: new Uint32Array([3, 0, 1, 2, 0, 1, 2, 3]),
      edgeRegions: new Uint32Array([0, 1, 2, 3]),
      regionIds: ['left', 'right', 'bottom', 'top'],
    };
    expect(boundaryAnchors(data)).toEqual([
      { region: 'left', point: [0, 0.5, 0], normal: [-1, 0, 0] },
      { region: 'right', point: [2, 0.5, 0], normal: [1, 0, 0] },
      { region: 'bottom', point: [1, 0, 0], normal: [0, -1, 0] },
      { region: 'top', point: [1, 1, 0], normal: [0, 1, -0] },
    ]);
  });
  it('keeps a curved boundary anchor on a real facet rather than its interior averaged point', () => {
    const data: SurfaceData = {
      positions: new Float64Array([1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]),
      triangles: new Uint32Array(),
      regions: new Uint32Array(),
      boundaryEdges: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0]),
      edgeRegions: new Uint32Array([0, 0, 0, 0]),
      regionIds: ['circle'],
    };
    const anchor = boundaryAnchors(data)[0];
    expect(anchor.region).toBe('circle');
    expect(Math.hypot(...anchor.point)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...anchor.normal)).toBeCloseTo(1);
    expect(anchor.point[0] * anchor.normal[0] + anchor.point[1] * anchor.normal[1]).toBeGreaterThan(
      0,
    );
  });
  it('maps 3D face IDs to face centroids and skips degenerate facets', () => {
    const data: SurfaceData = {
      positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangles: new Uint32Array([0, 1, 2, 0, 0, 0]),
      regions: new Uint32Array([0, 1]),
      regionIds: ['face', 'degenerate'],
    };
    expect(boundaryAnchors(data)).toEqual([
      { region: 'face', point: [1 / 3, 1 / 3, 0], normal: [0, 0, 1] },
    ]);
  });
  it('identifies prescribed support axes and distinguishes force from pressure units', () => {
    const support: Constraint = {
      id: 'support',
      name: 'Roller',
      regions: ['bottom'],
      components: [null, 0, null],
    };
    expect(supportDescription(support, '2d')).toBe('Y = 0 m');
    const load: Load = {
      id: 'load',
      name: 'Push',
      regions: ['right'],
      kind: 'force',
      vector: [10, -5, 0],
      pressure: 20,
    };
    expect(loadDescription(load, '2d')).toBe('Force (10, -5) N');
    expect(loadDescription({ ...load, kind: 'pressure' }, '2d')).toBe('Pressure 20 Pa');
  });
});
