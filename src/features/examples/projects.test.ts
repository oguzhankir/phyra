import { describe, expect, it } from 'vitest';
import { makeProject, type ExampleId } from './projects';

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
    },
  );
  it('creates an editable new project without implicit restraints or forces', () => {
    const project = makeProject();
    expect(project.study.constraints).toEqual([]);
    expect(project.study.loads).toEqual([]);
    expect(project.name).toBe('Untitled project');
  });
  it('retains nonzero displacement and genuinely free components without external loading', () => {
    const project = makeProject('extension');
    expect(project.study.constraints[1].components).toEqual([0.0001, null, null]);
    expect(project.study.loads).toEqual([]);
  });
});
