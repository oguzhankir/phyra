import { describe, expect, it } from 'vitest';
import type {
  CadFeature,
  CadGeometry,
  CadSketchFeature,
} from '../../domain/contracts/project.generated';
import { profileGraph } from '../../domain/geometry/sketchGraph';
import { rectangularProfile } from '../../domain/project/profile';
import {
  advancedIssue,
  bodyInputs,
  componentPlacement,
  pathInputs,
  pathIssue,
  profileInputs,
} from './advancedFeatures';
import { cadRebuildIssue } from './featureWorkflow';
const profile: CadSketchFeature = {
  id: 'profile',
  name: 'Profile',
  kind: 'sketch',
  plane: 'yz',
  sketch: profileGraph({ ...rectangularProfile(0.01, 0.02), holes: [] }),
};
const path: CadSketchFeature = {
  id: 'path',
  name: 'Path',
  kind: 'sketch',
  plane: 'xy',
  purpose: 'path',
  sketch: {
    points: [
      { id: 'a', position: [0, 0] },
      { id: 'b', position: [0.1, 0] },
      { id: 'c', position: [0.1, 0.1] },
    ],
    entities: [
      { id: 'ab', name: 'AB', kind: 'line', startId: 'a', endId: 'b' },
      { id: 'bc', name: 'BC', kind: 'line', startId: 'b', endId: 'c' },
    ],
    constraints: [],
    loops: [],
  },
};
const placed: CadFeature = {
  id: 'placed',
  name: 'Placed profile',
  kind: 'transform',
  inputId: 'profile',
  translation: [0.05, 0, 0],
  axisOrigin: [0, 0, 0],
  axisDirection: [0, 0, 1],
  angle: 0,
};
function geometry(features: CadFeature[]): CadGeometry {
  return {
    kind: 'cad',
    dimension: '3d',
    features: features as CadGeometry['features'],
    outputFeatureId: features.at(-1)!.id,
    assets: [],
  };
}
describe('advanced CAD authoring admission', () => {
  it('admits a connected open sweep spine only in its operation context', () => {
    const sweep: CadFeature = {
      id: 'sweep',
      name: 'Sweep',
      kind: 'sweep',
      profileId: 'profile',
      spineId: 'path',
      solid: true,
    };
    expect(pathIssue(path.sketch)).toBeNull();
    expect(pathInputs([profile, path]).map((item) => item.id)).toEqual(['path']);
    expect(cadRebuildIssue(geometry([profile, path, sweep]))).toBeNull();
    expect(cadRebuildIssue(geometry([profile, path]))).toContain('Path');
    expect(cadRebuildIssue(geometry([profile, path]))).toContain('Use Sweep');
    const broken = structuredClone(path);
    broken.sketch.points.push({ id: 'd', position: [0.2, 0] });
    broken.sketch.entities.push({
      id: 'bd',
      name: 'Branch',
      kind: 'line',
      startId: 'b',
      endId: 'd',
    });
    expect(pathIssue(broken.sketch)).toContain('branches');
  });
  it('rejects disconnected paths even when every local vertex has valid degree', () => {
    const broken = structuredClone(path);
    broken.sketch.points.push(
      { id: 'x', position: [0.3, 0] },
      { id: 'y', position: [0.4, 0] },
      { id: 'z', position: [0.4, 0.1] },
    );
    broken.sketch.entities.push(
      { id: 'xy', name: 'XY', kind: 'line', startId: 'x', endId: 'y' },
      { id: 'yz', name: 'YZ', kind: 'line', startId: 'y', endId: 'z' },
      { id: 'zx', name: 'ZX', kind: 'line', startId: 'z', endId: 'x' },
    );
    expect(pathIssue(broken.sketch)).toContain('disconnected');
  });
  it('resolves placed profiles without admitting bodies or hole contours as sections', () => {
    const features = [
      profile,
      placed,
      { id: 'box', name: 'Box', kind: 'box' as const, length: 0.1, width: 0.1, height: 0.1 },
    ];
    expect(profileInputs(features).map((item) => item.id)).toEqual(['profile', 'placed']);
    const loft: CadFeature = {
      id: 'loft',
      name: 'Loft',
      kind: 'loft',
      sectionIds: ['profile', 'placed'],
      solid: false,
      ruled: false,
    };
    expect(advancedIssue(loft, features)).toBeNull();
    expect(bodyInputs([...features, loft]).map((item) => item.id)).toEqual(['box']);
    const withHole = structuredClone(profile);
    withHole.sketch.loops.push({ id: 'hole', role: 'hole', entityIds: ['unused'] });
    expect(profileInputs([withHole])).toHaveLength(0);
    expect(profileInputs([{ ...profile, purpose: 'path' }])).toHaveLength(0);
  });
  it('accepts reusable body sources as distinct assembly instances and keeps unsupported study operations gated', () => {
    const box: CadFeature = {
      id: 'box',
      name: 'Box',
      kind: 'box',
      length: 0.1,
      width: 0.1,
      height: 0.1,
    };
    const assembly: CadFeature = {
      id: 'assembly',
      name: 'Assembly',
      kind: 'assembly',
      components: [
        { id: 'a', name: 'Left', featureId: 'box' },
        { id: 'b', name: 'Right', featureId: 'box' },
      ],
    };
    expect(advancedIssue(assembly, [box])).toBeNull();
    expect(cadRebuildIssue(geometry([box, assembly]))).toBeNull();
    assembly.components[1].featureId = 'profile';
    expect(advancedIssue(assembly, [box, profile])).toContain('solid source');
  });
  it('splits a shared placement before moving one assembly instance, preserving the other pose', () => {
    const box: CadFeature = {
      id: 'box',
      name: 'Box',
      kind: 'box',
      length: 0.1,
      width: 0.1,
      height: 0.1,
    };
    const placement: CadFeature = { ...placed, inputId: 'box', translation: [0.2, 0, 0] };
    const assembly: Extract<CadFeature, { kind: 'assembly' }> = {
      id: 'assembly',
      name: 'Assembly',
      kind: 'assembly',
      components: [
        { id: 'left', name: 'Left', featureId: placement.id },
        { id: 'right', name: 'Right', featureId: placement.id },
      ],
    };
    const prepared = componentPlacement([box, placement, assembly], assembly, 'left')!;
    expect(prepared.insert).toBe(true);
    expect(prepared.placement.id).not.toBe(placement.id);
    expect(prepared.placement.inputId).toBe('box');
    expect(prepared.placement.translation).toEqual([0.2, 0, 0]);
    prepared.placement.translation[0] = 0.3;
    expect(placement.translation[0]).toBe(0.2);
    const independent = structuredClone(assembly);
    independent.components[0].featureId = prepared.placement.id;
    expect(
      componentPlacement([box, placement, prepared.placement, independent], independent, 'left')
        ?.insert,
    ).toBe(false);
  });
});
