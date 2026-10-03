import { describe, expect, it } from 'vitest';
import {
  boundaryAnchors,
  boundaryGlyphAnchors,
  loadDescription,
  supportDescription,
  loadSummary,
  supportSummary,
} from './boundaryMarkers';
import type { SurfaceData } from './surface';
import type { Constraint, Load } from '../../domain/contracts/types';

describe('located boundary conditions', () => {
  it('samples a bounded spatial spread of real facets for distributed arrows with outward normals', () => {
    const data: SurfaceData = {
      positions: new Float64Array([1, 0, 0, 1, 1, 0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 1, 5, 0]),
      triangles: new Uint32Array(),
      regions: new Uint32Array(),
      boundaryEdges: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]),
      edgeRegions: new Uint32Array([0, 0, 0, 0, 0]),
      regionIds: ['right'],
    };
    const samples = boundaryGlyphAnchors(data).get('right')!;
    expect(samples).toHaveLength(3);
    expect(samples.map((anchor) => anchor.point[1])).toEqual([2.5, 0.5, 4.5]);
    expect(samples.every((anchor) => anchor.point[0] === 1 && anchor.normal[0] === 1)).toBe(true);
    expect([...data.positions]).toEqual([1, 0, 0, 1, 1, 0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 1, 5, 0]);
  });
  it('does not duplicate a single facet to imply extra spatial samples', () => {
    const data: SurfaceData = {
      positions: new Float64Array([0, 0, 0, 1, 0, 0]),
      triangles: new Uint32Array(),
      regions: new Uint32Array(),
      boundaryEdges: new Uint32Array([0, 1]),
      edgeRegions: new Uint32Array([0]),
      regionIds: ['bottom'],
    };
    expect(boundaryGlyphAnchors(data).get('bottom')).toHaveLength(1);
  });
  it('shows actual force magnitude, signed pressure, local traction and prescribed displacements in declared units', () => {
    const force: Load = {
      id: 'f',
      name: 'Force',
      regions: ['right'],
      kind: 'force',
      vector: [3, 4, 12],
      pressure: 0,
    };
    expect(loadSummary(force, '2d')).toBe('Total force · 5 N');
    expect(loadSummary(force, '3d')).toBe('Total force · 13 N');
    expect(loadSummary({ ...force, kind: 'pressure', pressure: -2e6 }, '2d')).toBe(
      'Pressure · -2 MPa',
    );
    expect(
      loadSummary(
        {
          ...force,
          kind: 'traction',
          traction: { kind: 'affine', xx: [3e6, 0, 0], yy: [0, 0, 0], xy: [4e6, 0, 0] },
        },
        '2d',
        { region: 'right', point: [1, 0.5, 0], normal: [1, 0, 0] },
      ),
    ).toBe('Traction · 5 MPa here');
    expect(
      supportSummary({ id: 'c', name: 'Fixed', regions: ['left'], components: [0, 0, null] }, '2d'),
    ).toBe('Fixed · X, Y');
    expect(
      supportSummary(
        { id: 'c', name: 'Moved', regions: ['left'], components: [0.001, null, null] },
        '2d',
        'mm',
      ),
    ).toBe('Displacement · X 1 mm');
  });
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
