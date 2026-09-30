import type { Project } from '../contracts/types';

export function inputError(project: Project): string | null {
  const g = project.geometry;
  const dimensions =
    project.study.dimension === '2d'
      ? [g.length, g.width, project.study.thickness]
      : g.kind === 'cylinder'
        ? [g.length, g.radius]
        : g.kind === 'bracket'
          ? [g.length, g.width, g.height, g.thickness]
          : [g.length, g.width, g.height];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0 || value > 1000))
    return 'Geometry dimensions must be finite, positive, and at most 1,000 m.';
  if (g.kind === 'bracket' && g.thickness >= Math.min(g.length, g.width))
    return 'Bracket thickness must be smaller than both leg dimensions.';
  if (!(project.study.material.young > 0) || project.study.material.young > 1e15)
    return 'Young’s modulus must be positive and at most 1,000,000 GPa.';
  if (!(project.study.material.poisson > -1 && project.study.material.poisson <= 0.45))
    return 'Poisson’s ratio must be greater than −1 and at most 0.45 for this formulation.';
  if (!(project.study.mesh.size > 0) || project.study.mesh.size > 1000)
    return 'Mesh size must be positive and at most 1,000 m.';
  if (project.study.solver.kind === 'pinn' && project.study.dimension !== '2d')
    return 'PINN is supported for 2D plane stress only.';
  const settings = project.study.solver.pinn;
  if (
    ![
      settings.layers,
      settings.width,
      settings.steps,
      settings.interiorPoints,
      settings.boundaryPoints,
      settings.seed,
    ].every(Number.isInteger) ||
    settings.layers < 1 ||
    settings.layers > 6 ||
    settings.width < 4 ||
    settings.width > 128 ||
    settings.steps < 1 ||
    settings.steps > 20000 ||
    settings.interiorPoints < 8 ||
    settings.interiorPoints > 4096 ||
    settings.boundaryPoints < 4 ||
    settings.boundaryPoints > 1024 ||
    settings.seed < 0 ||
    settings.seed > 2147483647
  )
    return 'PINN architecture, sample counts, training steps, and seed must be supported integers.';
  if (!(settings.learningRate >= 1e-6 && settings.learningRate <= 0.05))
    return 'Learning rate must be between 0.000001 and 0.05.';
  if (
    project.study.constraints.some(
      (item) => !item.regions.length || item.components.every((component) => component === null),
    )
  )
    return 'Each support needs at least one boundary and one prescribed component.';
  if (project.study.loads.some((item) => !item.regions.length))
    return 'Each load needs at least one boundary.';
  if (
    !project.name.trim() ||
    !project.study.material.name.trim() ||
    project.study.constraints.some((item) => !item.name.trim()) ||
    project.study.loads.some((item) => !item.name.trim())
  )
    return 'Project, material, support, and load names cannot be empty.';
  return null;
}
