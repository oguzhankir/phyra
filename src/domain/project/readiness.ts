import type { Project } from '../contracts/types';
import { boundaryPoints } from './boundaryGeometry';
import { projectRegions } from './regions';
import { cadSolidSourceError, isCadSolidProject, type CadSolidSource } from './cadSolid';
import { inputError } from './validation';
import { profileError } from './profile';
import { supportsPinn } from './study';

export type PreparationSection =
  'study' | 'geometry' | 'material' | 'constraints' | 'loads' | 'mesh' | 'solver';
export type PreparationState = 'complete' | 'missing' | 'invalid' | 'review';
export interface PreparationCheck {
  section: PreparationSection;
  label: string;
  state: PreparationState;
  detail: string;
}
export interface StudyPreparation {
  checks: PreparationCheck[];
  completed: number;
  total: number;
  canMesh: boolean;
  canRun: boolean;
  restraintRank: number | null;
  rigidModes: number;
  firstMissing: PreparationSection | null;
}

function matrixRank(rows: number[][], columns: number): number {
  const matrix = rows.map((row) => [...row]);
  let rank = 0;
  for (let column = 0; column < columns && rank < matrix.length; column++) {
    let pivot = rank;
    for (let row = rank + 1; row < matrix.length; row++)
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    if (Math.abs(matrix[pivot][column]) <= 1e-10) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
    const value = matrix[rank][column];
    for (let c = column; c < columns; c++) matrix[rank][c] /= value;
    for (let row = 0; row < matrix.length; row++) {
      if (row === rank) continue;
      const factor = matrix[row][column];
      for (let c = column; c < columns; c++) matrix[row][c] -= factor * matrix[rank][c];
    }
    rank++;
  }
  return rank;
}

// Restrict u = translation + rotation × position to prescribed components.
// Same rigid-motion space as the worker's mesh-based restraint test. This
// definition-level test does not replace the worker's SVD or a mesh check.
export function restraintRank(project: Project): number | null {
  // Exact face identity contains no nodal coordinates. The worker checks the
  // actual generated mesh; display triangles and bounding boxes cannot prove rank.
  if (project.geometry.kind === 'cad') return null;
  const dimension = project.study.dimension === '2d' ? 2 : 3;
  const points = project.study.constraints.flatMap((item) =>
    item.regions.flatMap((region) => boundaryPoints(project, region)),
  );
  if (!points.length) return 0;
  const center = [0, 1, 2].map(
    (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
  );
  const scale = Math.max(
    ...points.flatMap((point) => point.map((value, axis) => Math.abs(value - center[axis]))),
  );
  if (!(scale > 0) || !Number.isFinite(scale)) return 0;
  const rows: number[][] = [];
  for (const support of project.study.constraints)
    for (const region of support.regions)
      for (const point of boundaryPoints(project, region)) {
        const [x, y, z] = point.map((value, axis) => (value - center[axis]) / scale);
        const basis =
          dimension === 2
            ? [
                [1, 0, -y],
                [0, 1, x],
              ]
            : [
                [1, 0, 0, 0, z, -y],
                [0, 1, 0, -z, 0, x],
                [0, 0, 1, y, -x, 0],
              ];
        for (let component = 0; component < dimension; component++)
          if (support.components[component] !== null) rows.push(basis[component]);
      }
  return matrixRank(rows, dimension === 2 ? 3 : 6);
}

function supportConflict(project: Project): boolean {
  const prescribed = new Map<string, number>();
  for (const support of project.study.constraints)
    for (const region of support.regions)
      for (const location of project.geometry.kind === 'cad'
        ? [region]
        : boundaryPoints(project, region).map((point) => point.join(':')))
        for (let axis = 0; axis < (project.study.dimension === '2d' ? 2 : 3); axis++) {
          const value = support.components[axis];
          if (value === null) continue;
          const key = `${location}:${axis}`;
          const previous = prescribed.get(key);
          if (
            previous !== undefined &&
            Math.abs(previous - value) >
              64 * Number.EPSILON * Math.max(Math.abs(previous), Math.abs(value), Number.MIN_VALUE)
          )
            return true;
          prescribed.set(key, value);
        }
  return false;
}

export function prepareStudy(
  project: Project,
  invalidDrafts = 0,
  cadSource?: CadSolidSource | null,
): StudyPreparation {
  const { geometry: g, study } = project;
  const is2D = study.dimension === '2d';
  const boundaries = new Set(projectRegions(project).map((item) => item.id));
  const validRegions = (regions: string[]) =>
    regions.length > 0 && regions.every((id) => boundaries.has(id));
  const dimensions =
    g.kind === 'cad'
      ? []
      : g.kind === 'profile'
        ? [g.length, g.width]
        : is2D
          ? [g.length, g.width, study.thickness]
          : g.kind === 'cylinder'
            ? [g.length, g.radius]
            : g.kind === 'bracket'
              ? [g.length, g.width, g.height, g.thickness]
              : [g.length, g.width, g.height];
  const sourceError = isCadSolidProject(project) ? cadSolidSourceError(project, cadSource) : null;
  const geometryInvalid =
    !!sourceError ||
    dimensions.some((value) => !Number.isFinite(value) || value <= 0 || value > 1000) ||
    (g.kind === 'profile' && !!profileError(g.profile)) ||
    (g.kind === 'bracket' && g.thickness >= Math.min(g.length, g.width));
  const formulationInvalid =
    !project.name.trim() ||
    (is2D
      ? (g.kind !== 'box' && g.kind !== 'profile') ||
        study.formulation !== 'plane-stress' ||
        !(study.thickness > 0 && study.thickness <= 1000)
      : study.formulation !== 'solid' || g.kind === 'profile');
  const materialInvalid =
    !study.material.name.trim() ||
    !(study.material.young > 0 && study.material.young <= 1e15) ||
    !(study.material.poisson > -1 && study.material.poisson <= 0.45);
  const supportInvalid = study.constraints.some(
    (item) =>
      !item.name.trim() ||
      !validRegions(item.regions) ||
      item.components.every((value) => value === null) ||
      item.components.some((value) => value !== null && !Number.isFinite(value)) ||
      (is2D && item.components[2] !== null),
  );
  const rank =
    g.kind === 'cad' ? null : !geometryInvalid && !supportInvalid ? restraintRank(project) : 0;
  const rigidModes = is2D ? 3 : 6;
  const conflict = !geometryInvalid && !supportInvalid && supportConflict(project);
  const displaced = study.constraints.some((item) =>
    item.components.some((value) => value !== null && value !== 0),
  );
  const loadInvalid = study.loads.some(
    (item) =>
      !item.name.trim() ||
      !validRegions(item.regions) ||
      !item.vector.every(Number.isFinite) ||
      !Number.isFinite(item.pressure) ||
      (is2D && item.vector[2] !== 0) ||
      (!is2D && item.kind === 'traction') ||
      (item.kind === 'traction' && !item.traction),
  );
  const nonzeroLoad = study.loads.some((item) =>
    item.kind === 'force'
      ? item.vector.some((value) => value !== 0)
      : item.kind === 'pressure'
        ? item.pressure !== 0
        : !!item.traction,
  );
  const meshInvalid =
    (g.kind === 'cad' && study.mesh.boundarySize !== undefined) ||
    !(study.mesh.size > 0 && study.mesh.size <= 1000) ||
    (study.mesh.boundarySize !== undefined &&
      !(study.mesh.boundarySize > 0 && study.mesh.boundarySize <= 1000));
  const methodInvalid = study.solver.kind === 'pinn' && !supportsPinn(project);
  const check = (
    section: PreparationSection,
    label: string,
    state: PreparationState,
    detail: string,
  ): PreparationCheck => ({ section, label, state, detail });
  const checks = [
    check(
      'study',
      'Study',
      formulationInvalid ? 'invalid' : 'complete',
      formulationInvalid
        ? 'Repair the formulation, project name or thickness.'
        : is2D
          ? '2D plane stress · physical thickness defined'
          : '3D solid · static structural',
    ),
    check(
      'geometry',
      'Geometry',
      geometryInvalid ? 'invalid' : 'complete',
      geometryInvalid
        ? (sourceError ?? 'Repair the dimensions or profile topology.')
        : `${g.kind === 'cad' ? 'Exact CAD solid' : g.kind === 'box' && is2D ? 'Rectangle' : g.kind} · ${boundaries.size} boundary regions`,
    ),
    check(
      'material',
      'Material',
      materialInvalid ? 'invalid' : 'complete',
      materialInvalid
        ? 'Enter admissible elastic constants.'
        : `${study.material.name} · E and ν supplied`,
    ),
    check(
      'constraints',
      'Supports',
      supportInvalid || conflict
        ? 'invalid'
        : !study.constraints.length || (rank !== null && rank < rigidModes)
          ? 'missing'
          : rank === null
            ? 'review'
            : 'complete',
      conflict
        ? 'Overlapping supports prescribe conflicting displacements.'
        : supportInvalid
          ? 'Repair boundary assignments or displacement components.'
          : !study.constraints.length
            ? 'No supports assigned.'
            : rank === null
              ? 'Rigid-motion and overlapping-support checks run on the generated mesh.'
              : rank < rigidModes
                ? `${rigidModes - rank} rigid-motion mode(s) remain free. Add independent restraints.`
                : `${study.constraints.length} support(s) · rigid-motion check passed`,
    ),
    check(
      'loads',
      'Excitation',
      loadInvalid
        ? 'invalid'
        : !study.loads.length && !displaced
          ? 'missing'
          : !nonzeroLoad && !displaced
            ? 'review'
            : 'complete',
      loadInvalid
        ? 'Repair load values or assigned boundaries.'
        : displaced && !study.loads.length
          ? 'Prescribed displacement drives the study · no external load needed'
          : !study.loads.length
            ? 'No load or nonzero prescribed displacement.'
            : !nonzeroLoad && !displaced
              ? 'All load values are zero · expect a zero-response study'
              : `${study.loads.length} load(s) assigned${displaced ? ' · prescribed displacement included' : ''}`,
    ),
    check(
      'mesh',
      'Mesh settings',
      meshInvalid ? 'invalid' : 'complete',
      meshInvalid
        ? g.kind === 'cad' && study.mesh.boundarySize !== undefined
          ? 'Exact CAD solid meshing supports one global target size. Remove boundary refinement.'
          : 'Enter positive supported mesh sizes.'
        : 'Element size supplied · mesh generated by the run if needed',
    ),
    check(
      'solver',
      'Method',
      methodInvalid ? 'invalid' : 'complete',
      methodInvalid
        ? 'Choose a supported geometry/method combination.'
        : study.solver.kind === 'pinn'
          ? 'PINN · experimental · review training settings'
          : 'Finite element method · local CPU',
    ),
  ];
  const invalid = inputError(project);
  if (invalid && !checks.some((item) => item.state === 'invalid')) {
    const item = checks.find((item) => item.section === 'solver')!;
    item.state = 'invalid';
    item.detail = invalid;
  }
  if (invalidDrafts) {
    const item = checks[0];
    item.state = 'invalid';
    item.detail = 'Complete or revert the active numeric draft.';
  }
  const missing = checks.find((item) => item.state === 'missing' || item.state === 'invalid');
  return {
    checks,
    completed: checks.filter((item) => item.state === 'complete' || item.state === 'review').length,
    total: checks.length,
    canMesh: !geometryInvalid && !formulationInvalid && !meshInvalid && !invalidDrafts,
    canRun: !missing,
    restraintRank: rank,
    rigidModes,
    firstMissing: missing?.section ?? null,
  };
}
