import type { Project, Operation } from '../contracts/types';

export function changeStudyDimension(
  project: Project,
  dimension: Project['study']['dimension'],
): void {
  if (project.study.dimension === dimension) return;
  if (project.geometry.kind === 'cad')
    throw new Error('Exact CAD solid studies remain 3D. Change geometry in the CAD workspace.');
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
      'Choose a compatible 2D plane-stress PINN formulation: strong-form for rectangular domains, potential energy for rectangles and profiles.',
    );
  project.study.solver.kind = kind;
}
export function primaryOperation(project: Project): Operation {
  return project.study.solver.kind === 'pinn' ? 'train' : 'solve';
}

export function supportsPinn(project: Project): boolean {
  return (
    project.study.dimension === '2d' &&
    (project.study.solver.pinn.formulation === 'potential-energy'
      ? ['box', 'profile'].includes(project.geometry.kind)
      : project.geometry.kind === 'box' &&
        project.study.loads.every((load) => load.kind !== 'traction'))
  );
}
