import { describe, expect, it } from 'vitest';
import type { CadSolidProject } from '../../domain/contracts/types';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import { makeProject } from '../examples/projects';
import { cadPreparationSurface, surfaceData } from './surface';

function fixture() {
  const first = `solid/face/${'a'.repeat(24)}`;
  const second = `solid/face/${'b'.repeat(24)}`;
  const project: CadSolidProject = {
    ...makeProject(),
    geometry: {
      kind: 'cad',
      dimension: '3d',
      assets: [],
      outputFeatureId: 'solid',
      features: [{ id: 'solid', name: 'Solid', kind: 'box', length: 1, width: 1, height: 1 }],
    },
    study: {
      ...makeProject().study,
      domain: {
        kind: 'cad-solid',
        geometryFingerprint: 'a'.repeat(64),
        outputFeatureId: 'solid',
        boundaries: [
          { id: 'face-a', faceId: first, name: 'First' },
          { id: 'face-b', faceId: second, name: 'Second' },
        ],
      },
    },
  };
  // Two display facets, intentionally ordered differently from the saved catalog.
  const preview: CadPreview = {
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
    triangleFaces: new Uint32Array([1, 0]),
    edgePositions: new Float64Array(),
    edgeSegments: new Uint32Array(),
    segmentEdges: new Uint32Array(),
    faces: [
      { id: second, name: 'Second', identity: 'content-reference' },
      { id: first, name: 'First', identity: 'content-reference' },
    ],
    edges: [],
    bodies: [],
  };
  return { project, preview };
}

describe('exact CAD analysis preparation display', () => {
  it('maps exact face identity into safe boundary IDs independently of face ordering', () => {
    const { project, preview } = fixture();
    const display = cadPreparationSurface(project, preview);
    expect(display.regionIds).toEqual(['face-a', 'face-b']);
    expect([...display.regions]).toEqual([0, 1]);
    expect(display.positions).toBe(preview.positions);
    expect(display.triangles).toBe(preview.triangles);
    expect(display.cells).toBeUndefined();
    expect(display.volumeCells).toBeUndefined();
    expect(display.displacement).toBeUndefined();
    expect(project.study.domain.boundaries.map((face) => face.id)).toEqual(['face-a', 'face-b']);
  });

  it('does not invent a primitive when a saved CAD study has no current exact preview', () => {
    const { project } = fixture();
    const display = surfaceData(project, null);
    expect(display.positions).toHaveLength(0);
    expect(display.triangles).toHaveLength(0);
    expect(display.regionIds).toEqual(['face-a', 'face-b']);
  });

  it.each(['unknown', 'ambiguous', 'duplicate', 'missing'] as const)(
    'rejects %s exact face correspondence',
    (kind) => {
      const { project, preview } = fixture();
      if (kind === 'unknown') preview.faces[0].id = `solid/face/${'c'.repeat(24)}`;
      if (kind === 'ambiguous') preview.faces[0].identity = 'ambiguous';
      if (kind === 'duplicate') preview.faces[0].id = preview.faces[1].id;
      if (kind === 'missing') preview.faces.pop();
      expect(() => cadPreparationSurface(project, preview)).toThrow('Rebuild');
    },
  );

  it('rejects display triangles that address a missing face', () => {
    const { project, preview } = fixture();
    preview.triangleFaces[0] = 2;
    expect(() => cadPreparationSurface(project, preview)).toThrow('mapping');
  });
});
