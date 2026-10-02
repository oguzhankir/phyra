import { describe, expect, it } from 'vitest';
import { makeProject, type ExampleId } from '../../features/examples/projects';
import { prepareStudy, restraintRank } from './readiness';
import { boundaryPoints } from './boundaryGeometry';

describe('definition preparation', () => {
  it('shows exactly what a new definition lacks without blocking meshing', () => {
    const preparation = prepareStudy(makeProject());
    expect(preparation.canRun).toBe(false);
    expect(preparation.canMesh).toBe(true);
    expect(preparation.firstMissing).toBe('constraints');
    expect(
      preparation.checks.filter((item) => item.state === 'missing').map((item) => item.section),
    ).toEqual(['constraints', 'loads']);
  });
  it.each<ExampleId>([
    'cantilever',
    'cylinder',
    'bracket',
    'extension',
    'plane-stress-tension',
    'kirsch-quarter',
  ])('accepts the editable %s definition', (id) => {
    const project = makeProject(id);
    const readiness = prepareStudy(project);
    expect(readiness.canRun, JSON.stringify(readiness.checks)).toBe(true);
    expect(readiness.restraintRank).toBe(readiness.rigidModes);
  });
  it('recognizes a displacement-driven problem without adding an artificial force', () => {
    const project = makeProject('extension');
    project.study.loads = [];
    expect(prepareStudy(project).canRun).toBe(true);
  });
  it('detects unconstrained rigid motion even when a support has been assigned', () => {
    const project = makeProject('cantilever');
    project.study.constraints[0].components = [0, null, null];
    expect(restraintRank(project)).toBe(3);
    expect(prepareStudy(project).checks.find((item) => item.section === 'constraints')?.state).toBe(
      'missing',
    );
  });
  it('keeps rigid-space rank invariant under positive uniform geometric scaling', () => {
    for (const scale of [1e-9, 1, 100]) {
      const project = makeProject('cantilever');
      project.geometry.length *= scale;
      project.geometry.width *= scale;
      project.geometry.height *= scale;
      expect(restraintRank(project)).toBe(6);
    }
  });
  it('finds conflicting prescribed values on touching boundaries', () => {
    const project = makeProject('cantilever');
    project.study.constraints.push({
      ...structuredClone(project.study.constraints[0]),
      id: crypto.randomUUID(),
      regions: ['y0'],
      components: [0.001, null, null],
    });
    expect(
      prepareStudy(project).checks.find((item) => item.section === 'constraints')?.detail,
    ).toContain('conflicting');
  });
  it('permits an explicitly assigned zero load with a visible review note', () => {
    const project = makeProject('cantilever');
    project.study.loads[0].vector = [0, 0, 0];
    const readiness = prepareStudy(project);
    expect(readiness.canRun).toBe(true);
    expect(readiness.checks.find((item) => item.section === 'loads')?.state).toBe('review');
  });
  it('blocks stale boundary assignments and incomplete numeric drafts', () => {
    const project = makeProject('cantilever');
    project.study.loads[0].regions = ['not-a-boundary'];
    expect(prepareStudy(project).canRun).toBe(false);
    expect(prepareStudy(makeProject('cantilever'), 1).canMesh).toBe(false);
  });
  it('uses exact profile anchors and excludes nonexistent boundaries', () => {
    const project = makeProject('kirsch-quarter');
    expect(boundaryPoints(project, 'hole')).toHaveLength(3);
    expect(boundaryPoints(project, 'not-a-boundary')).toEqual([]);
    expect(boundaryPoints(makeProject('cylinder'), 'outer')).toHaveLength(8);
  });
});
