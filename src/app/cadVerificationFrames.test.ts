import { describe, expect, it } from 'vitest';
import { makeProject } from '../features/examples/projects';
import type { CadSolidProject } from '../domain/contracts/types';
import type { CadPreparationRender } from '../platform/desktop/verification';
import { acceptsCadPreparationFrame } from './cadVerificationFrames';

function fixture() {
  const project: CadSolidProject = {
    ...makeProject(),
    geometry: {
      kind: 'cad',
      dimension: '3d',
      outputFeatureId: 'solid',
      assets: [],
      features: [{ id: 'solid', name: 'Solid', kind: 'box', length: 1, width: 1, height: 1 }],
    },
    study: {
      ...makeProject().study,
      domain: {
        kind: 'cad-solid',
        geometryFingerprint: 'a'.repeat(64),
        outputFeatureId: 'solid',
        boundaries: [{ id: 'face-a', faceId: `solid/face/${'a'.repeat(24)}`, name: 'Face' }],
      },
    },
  };
  const frame: CadPreparationRender = {
    projectId: project.id,
    studyId: project.study.id,
    geometryFingerprint: project.study.domain.geometryFingerprint,
    outputFeatureId: 'solid',
    region: 'face-a',
    clientX: 400,
    clientY: 300,
    triangles: 12,
  };
  return { project, frame };
}

describe('packaged CAD preparation frame ownership', () => {
  it('accepts the first owned render immediately after dialog submission without depending on the next React phase', () => {
    const { project, frame } = fixture();
    expect(acceptsCadPreparationFrame(project, structuredClone(project.geometry), frame)).toBe(
      true,
    );
  });
  it.each(['projectId', 'studyId', 'geometryFingerprint', 'outputFeatureId', 'region'] as const)(
    'rejects stale or unrelated %s evidence',
    (key) => {
      const { project, frame } = fixture();
      frame[key] = 'unrelated';
      expect(acceptsCadPreparationFrame(project, project.geometry, frame)).toBe(false);
    },
  );
  it('rejects a later edited source and a project that has no prepared domain', () => {
    const { project, frame } = fixture();
    const expected = structuredClone(project.geometry);
    project.geometry.features[0].name = 'Changed recipe';
    expect(acceptsCadPreparationFrame(project, expected, frame)).toBe(false);
    expect(acceptsCadPreparationFrame(makeProject(), expected, frame)).toBe(false);
  });
});
