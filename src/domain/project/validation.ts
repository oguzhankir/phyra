import type { Project } from '../contracts/types';
import { namedSelectionError } from './namedSelections';
import { profileError } from './profile';
import { projectRegions } from './regions';
import { supportsPinn } from './study';
import { cadSolidDomainError, isCadSolidProject } from './cadSolid';

export function inputError(project: Project): string | null {
  const selectionError = namedSelectionError(project);
  if (selectionError) return selectionError;
  const g = project.geometry;
  if (isCadSolidProject(project)) {
    const error = cadSolidDomainError(project);
    if (error) return error;
  }
  if (g.kind === 'profile') {
    if (project.study.dimension !== '2d') return 'Profiles require a 2D plane-stress study.';
    const error = profileError(g.profile);
    if (error) return error;
  } else if (project.study.dimension === '2d' && g.kind !== 'box')
    return 'The 2D study supports rectangles or line/arc profiles.';
  const dimensions =
    g.kind === 'cad'
      ? []
      : project.study.dimension === '2d'
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
  if (g.kind === 'cad' && project.study.mesh.boundarySize !== undefined)
    return 'Exact CAD solid meshing supports one global target size. Remove boundary refinement.';
  if (
    project.study.mesh.boundarySize !== undefined &&
    (!Number.isFinite(project.study.mesh.boundarySize) ||
      !(project.study.mesh.boundarySize > 0) ||
      project.study.mesh.boundarySize > 1000)
  )
    return 'Boundary mesh size must be finite, positive, and at most 1,000 m.';
  if (project.study.solver.kind === 'pinn' && !supportsPinn(project))
    return 'Strong-form PINN supports rectangular 2D force/pressure studies. Select potential energy for profiles and spatial traction, or choose FEM.';
  const boundaries = new Set(projectRegions(project).map((item) => item.id));
  for (const item of [...project.study.constraints, ...project.study.loads]) {
    const missing = item.regions.filter((id) => !boundaries.has(id));
    if (missing.length)
      return `${item.name} references deleted or renamed boundaries (${missing.join(', ')}). Explicitly repair its assigned boundaries.`;
  }
  for (const load of project.study.loads) {
    if (!load.vector.every(Number.isFinite) || !Number.isFinite(load.pressure))
      return 'Load values must be finite.';
    if (load.kind === 'traction') {
      if (project.study.dimension !== '2d')
        return 'Spatial traction is supported for 2D plane stress only.';
      const traction = load.traction;
      if (!traction) return `${load.name} needs a typed traction definition.`;
      if (
        traction.kind === 'affine' &&
        ![...traction.xx, ...traction.yy, ...traction.xy].every(Number.isFinite)
      )
        return 'Affine stress traction coefficients must be finite (constant Pa; X/Y coefficients Pa/m).';
      if (
        traction.kind === 'kirsch' &&
        (!(traction.radius > 0 && traction.radius <= 1000) ||
          !Number.isFinite(traction.tension) ||
          traction.center.some((value) => !Number.isFinite(value) || Math.abs(value) > 1000))
      )
        return 'Kirsch traction needs a finite positive radius, finite tension in Pa, and a finite center in m.';
    }
  }
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
