import { describe, expect, it } from 'vitest';
import { makeProject, type ExampleId } from './projects';
import researchCases from '../../../examples/research-cases.json';
import { inputError } from '../../domain/project/validation';

describe('offline engineering examples', () => {
  it.each<ExampleId>(['cantilever', 'cylinder', 'bracket', 'extension'])(
    'loads %s with schema-checked SI inputs and new identities',
    (id) => {
      const first = makeProject(id);
      const second = makeProject(id);
      expect(first.id).not.toBe(second.id);
      expect(first.study.id).not.toBe(second.study.id);
      expect(first.geometry.length).toBeGreaterThan(0);
      expect(first.geometry.length).toBeLessThan(1);
      expect(first.study.material.young).toBe(70e9);
      expect(first.study.constraints[0].components).toEqual([0, 0, 0]);
      expect(first.study.constraints[0].id).not.toBe(second.study.constraints[0].id);
      expect(first.namedSelections[0].id).not.toBe(second.namedSelections[0].id);
      expect(first.namedSelections[0].regions).toEqual(first.study.constraints[0].regions);
    },
  );
  it('creates an editable new project without implicit restraints or forces', () => {
    const project = makeProject();
    expect(project.study.constraints).toEqual([]);
    expect(project.study.loads).toEqual([]);
    expect(project.name).toBe('Untitled project');
    expect(project.namedSelections).toEqual([]);
  });
  it('copies example boundary sets without linking them to existing conditions', () => {
    const project = makeProject('cantilever');
    project.namedSelections[0].regions = ['x1'];
    expect(project.study.constraints[0].regions).toEqual(['x0']);
  });
  it('retains nonzero displacement and genuinely free components without external loading', () => {
    const project = makeProject('extension');
    expect(project.study.constraints[1].components).toEqual([0.0001, null, null]);
    expect(project.study.loads).toEqual([]);
  });
  it.each(researchCases.cases)('opens the reusable research case $id with provenance', (entry) => {
    const project = makeProject(entry.id as ExampleId);
    expect(project.schemaVersion).toBe(8);
    expect(project.study.dimension).toBe('2d');
    expect(project.study.solver.pinn.formulation).toBe('potential-energy');
    expect(project.study.solver.pinn.device).toBe(entry.device);
    expect(entry.project).toBe(`${entry.id}.json`);
    expect(entry.seeds).toContain(project.study.solver.pinn.seed);
    expect(entry.deviations.length).toBeGreaterThan(0);
    expect(entry.acceptance).not.toBe('');
    expect(inputError(project)).toBeNull();
  });
  it('keeps the prescribed top half independent from its free collinear neighbor', () => {
    const project = makeProject('eccentric-displacement');
    const profile = project.geometry.profile!;
    expect(profile.outer.find((edge) => edge.id === 'top-driven')?.start).toEqual([0.5, 1]);
    expect(profile.outer.find((edge) => edge.id === 'top-free')?.end).toEqual([0.5, 1]);
    expect(project.study.constraints.map((item) => item.regions)).toEqual([
      ['bottom'],
      ['top-driven'],
    ]);
    expect(project.study.constraints[1].components).toEqual([0, 0.1, null]);
    expect(project.study.loads).toEqual([]);
  });
});
