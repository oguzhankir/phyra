import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import { numericalCadGeometry } from './cadConversion';
import { graphProfile } from './sketchGraph';

describe('explicit exact legacy geometry conversion', () => {
  it('converts a plane rectangle without adding the profile helper’s illustrative circular hole', () => {
    const project = makeProject('plane-stress-tension'),
      before = structuredClone(project);
    const converted = numericalCadGeometry(project)!;
    const sketch = converted.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected exact sketch.');
    const profile = graphProfile(sketch.sketch)!;
    expect(profile.holes).toEqual([]);
    expect(profile.outer.map((edge) => edge.end)).toEqual([
      [0.1, 0],
      [0.1, 0.05],
      [0, 0.05],
      [0, 0],
    ]);
    expect(project).toEqual(before);
  });
  it('preserves exact profile cutouts and 3D primitive dimensions while refusing an unimplemented bracket conversion', () => {
    const profile = makeProject('kirsch-quarter'),
      solid = makeProject('cantilever'),
      cylinder = makeProject('cylinder');
    const sketch = numericalCadGeometry(profile)!.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected exact sketch.');
    expect(graphProfile(sketch.sketch)).toEqual(profile.geometry.profile);
    expect(numericalCadGeometry(solid)?.features[0]).toMatchObject({
      kind: 'box',
      length: solid.geometry.length,
      width: solid.geometry.width,
      height: solid.geometry.height,
    });
    expect(numericalCadGeometry(cylinder)?.features[0]).toMatchObject({
      kind: 'cylinder',
      length: cylinder.geometry.length,
      radius: cylinder.geometry.radius,
    });
    expect(numericalCadGeometry(makeProject('bracket'))).toBeNull();
  });
});
