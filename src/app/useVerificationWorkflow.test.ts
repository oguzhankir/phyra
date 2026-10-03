import { describe, expect, it } from 'vitest';
import { makeProject } from '../features/examples/projects';
import { verificationProject } from './useVerificationWorkflow';

describe('packaged verification studies', () => {
  it('runs the energy tension example with CPU training and its generic physical definition', () => {
    const project = verificationProject('2d-energy');
    const example = makeProject('energy-tension');
    expect(project.geometry).toEqual(example.geometry);
    expect(project.study.material).toEqual(example.study.material);
    expect(project.study.constraints.map(({ id: _id, ...constraint }) => constraint)).toEqual(
      example.study.constraints.map(({ id: _id, ...constraint }) => constraint),
    );
    expect(project.study.loads.map(({ id: _id, ...load }) => load)).toEqual(
      example.study.loads.map(({ id: _id, ...load }) => load),
    );
    expect(project.study.solver.kind).toBe('pinn');
    expect(project.study.solver.pinn).toMatchObject({
      formulation: 'potential-energy',
      device: 'cpu',
      steps: 1200,
      layers: 2,
      width: 16,
      interiorPoints: 1024,
      boundaryPoints: 64,
    });
    // The verification fixture remains a copy of the editable example.
    project.study.solver.pinn.formulation = 'strong-form';
    expect(makeProject('energy-tension').study.solver.pinn.formulation).toBe('potential-energy');
  });

  it('preserves the prior strong-form, profile and solid verification routes', () => {
    const strong = verificationProject('2d-compare');
    expect(strong.study.solver.pinn).toMatchObject({
      formulation: 'strong-form',
      device: 'cpu',
      steps: 2000,
      interiorPoints: 128,
      boundaryPoints: 32,
    });
    expect(verificationProject('2d-profile').geometry.kind).toBe('profile');
    expect(verificationProject('3d').study.dimension).toBe('3d');
  });
});
