import type { Project, Operation } from '../contracts/types';

export function changeStudyDimension(
  project: Project,
  dimension: Project['study']['dimension'],
): void {
  if (project.study.dimension === dimension) return;
  project.study.dimension = dimension;
  project.study.formulation = dimension === '2d' ? 'plane-stress' : 'solid';
  project.study.constraints = [];
  project.study.loads = [];
  if (dimension === '2d') project.geometry.kind = 'box';
  else {
    project.study.solver.kind = 'fem';
    if (project.geometry.kind === 'profile') project.geometry.kind = 'box';
  }
  delete project.geometry.profile;
}
export function changeStudySolver(
  project: Project,
  kind: Project['study']['solver']['kind'],
): void {
  if (kind === 'pinn' && !supportsPinn(project))
    throw new Error(
      'PINN requires a rectangular 2D plane-stress study with force or pressure loads.',
    );
  project.study.solver.kind = kind;
}
export function primaryOperation(project: Project): Operation {
  return project.study.solver.kind === 'pinn' ? 'train' : 'solve';
}

export function supportsPinn(project: Project): boolean {
  return (
    project.study.dimension === '2d' &&
    project.geometry.kind === 'box' &&
    project.study.loads.every((load) => load.kind !== 'traction')
  );
}
