import type { ProjectDefinition } from '../domain/contracts/types';
import { isCadSolidProject } from '../domain/project/cadSolid';
import type { CadPreparationRender } from '../platform/desktop/verification';

/** Render publication can precede the verifier's next React phase, but must own its source. */
export function acceptsCadPreparationFrame(
  project: ProjectDefinition,
  expectedGeometry: ProjectDefinition['geometry'] | null,
  report: CadPreparationRender,
): boolean {
  return (
    isCadSolidProject(project) &&
    expectedGeometry !== null &&
    JSON.stringify(project.geometry) === JSON.stringify(expectedGeometry) &&
    report.projectId === project.id &&
    report.studyId === project.study.id &&
    report.geometryFingerprint === project.study.domain.geometryFingerprint &&
    report.outputFeatureId === project.study.domain.outputFeatureId &&
    project.study.domain.boundaries.some((boundary) => boundary.id === report.region) &&
    Number.isFinite(report.clientX) &&
    Number.isFinite(report.clientY) &&
    Number.isSafeInteger(report.triangles) &&
    report.triangles > 0
  );
}
