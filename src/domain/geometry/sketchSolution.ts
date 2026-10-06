import type { CadSketchDefinition, ProjectDefinition } from '../contracts/project.generated';
import { cadDefinitionError } from '../project/document';

export interface SketchSolveReport {
  status: 'solved' | 'redundant' | 'conflicting' | 'nonConverged' | 'tooManyUnknowns';
  degreesOfFreedom: number | null;
  failedConstraintIds: string[];
  kernel: string;
  sourceCommit: string;
}
export interface SketchSolution {
  protocolVersion: 1;
  operation: 'solve-sketch';
  status: 'succeeded';
  projectId: string;
  revision: number;
  jobId: string;
  featureId: string;
  geometryFingerprint: string;
  sketch: CadSketchDefinition;
  report: SketchSolveReport;
}

const graphKey = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

export const sameSketchDefinition = (
  first: CadSketchDefinition,
  second: CadSketchDefinition,
): boolean => graphKey(first) === graphKey(second);

/** A solve changes coordinates and radii, never authored identity or relationships. */
export function validateSketchSolution(
  receipt: SketchSolution,
  project: ProjectDefinition,
  featureId: string,
): SketchSolution {
  const source =
    project.geometry.kind === 'cad'
      ? project.geometry.features.find(
          (feature) => feature.kind === 'sketch' && feature.id === featureId,
        )
      : null;
  if (
    !source ||
    source.kind !== 'sketch' ||
    receipt.protocolVersion !== 1 ||
    receipt.operation !== 'solve-sketch' ||
    receipt.status !== 'succeeded' ||
    receipt.projectId !== project.id ||
    receipt.revision !== project.revision ||
    receipt.featureId !== featureId ||
    !/^[a-f0-9]{64}$/.test(receipt.geometryFingerprint) ||
    !receipt.jobId ||
    receipt.jobId.length > 100
  )
    throw new Error('Sketch solve ownership mismatch.');
  const graph = source.sketch,
    solved = receipt.sketch,
    report = receipt.report;
  if (
    !solved ||
    !report ||
    !Array.isArray(solved.points) ||
    !Array.isArray(solved.entities) ||
    graph.points.length !== solved.points.length ||
    graph.entities.length !== solved.entities.length ||
    graphKey(graph.constraints) !== graphKey(solved.constraints) ||
    graphKey(graph.loops) !== graphKey(solved.loops)
  )
    throw new Error('Sketch solver changed authored graph relationships.');
  for (let i = 0; i < graph.points.length; i++) {
    const point = solved.points[i];
    if (graphKey({ ...graph.points[i], position: point.position }) !== graphKey(point))
      throw new Error('Sketch solver changed point identity.');
  }
  for (let i = 0; i < graph.entities.length; i++) {
    const original = graph.entities[i],
      entity = solved.entities[i];
    const permitted =
      original.kind === 'circle' && entity.kind === 'circle'
        ? { ...original, radius: entity.radius }
        : original;
    if (graphKey(permitted) !== graphKey(entity))
      throw new Error('Sketch solver changed entity topology.');
  }
  if (
    solved.points.some(
      (point) =>
        !Array.isArray(point.position) ||
        point.position.length !== 2 ||
        point.position.some((value) => !Number.isFinite(value) || Math.abs(value) > 1000),
    ) ||
    solved.entities.some(
      (entity) =>
        entity.kind === 'circle' &&
        (!Number.isFinite(entity.radius) || entity.radius <= 0 || entity.radius > 1000),
    )
  )
    throw new Error('Sketch solve coordinates must be finite and bounded in SI.');
  const candidate = structuredClone(project);
  if (candidate.geometry.kind !== 'cad') throw new Error('Missing CAD source.');
  const feature = candidate.geometry.features.find((item) => item.id === featureId);
  if (!feature || feature.kind !== 'sketch') throw new Error('Missing authored sketch.');
  feature.sketch = structuredClone(solved);
  const issue = cadDefinitionError(candidate.geometry);
  if (issue) throw new Error(issue);
  const statuses: string[] = [
    'solved',
    'redundant',
    'conflicting',
    'nonConverged',
    'tooManyUnknowns',
  ];
  const known = new Set(graph.constraints.map((constraint) => constraint.id));
  if (
    !statuses.includes(report.status) ||
    (['solved', 'redundant'].includes(report.status)
      ? report.degreesOfFreedom === null
      : report.degreesOfFreedom !== null) ||
    (report.degreesOfFreedom !== null &&
      (!Number.isSafeInteger(report.degreesOfFreedom) ||
        report.degreesOfFreedom < 0 ||
        report.degreesOfFreedom > graph.points.length * 2 + graph.entities.length)) ||
    !Array.isArray(report.failedConstraintIds) ||
    new Set(report.failedConstraintIds).size !== report.failedConstraintIds.length ||
    report.failedConstraintIds.some((id) => !known.has(id)) ||
    typeof report.kernel !== 'string' ||
    !report.kernel ||
    report.kernel.length > 100 ||
    !/^[a-f0-9]{40}$/.test(report.sourceCommit)
  )
    throw new Error('Sketch solve diagnostics failed validation.');
  if (!['solved', 'redundant'].includes(report.status) && graphKey(solved) !== graphKey(graph))
    throw new Error('Failed sketch solve changed authored coordinates.');
  return receipt;
}
