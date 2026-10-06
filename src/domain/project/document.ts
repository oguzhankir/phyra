import type {
  CadFeature,
  CadGeometry,
  ProjectDefinition,
  NumericalProject,
} from '../contracts/types';
import { inputError } from './validation';
import type { StudyPreparation } from './readiness';

/** Shared with bounded worker framing, archives and recovery journals. */
export function documentSizeError(project: ProjectDefinition): string | null {
  return new TextEncoder().encode(JSON.stringify(project)).byteLength > 1024 * 1024
    ? 'Project definition exceeds the 1 MiB document limit. Reduce CAD features or imported metadata before continuing.'
    : null;
}

/** Only this narrowed definition may enter the existing mechanics paths. */
export function isNumericalProject(project: ProjectDefinition): project is NumericalProject {
  return (
    project.study !== null &&
    ['box', 'cylinder', 'bracket', 'profile'].includes(project.geometry.kind)
  );
}

export function blankProject(
  name = 'Untitled project',
  dimension: '2d' | '3d' = '3d',
): ProjectDefinition {
  return {
    schemaVersion: 6,
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled project',
    revision: 0,
    displayUnits: 'mm',
    geometry: { kind: 'empty', dimension },
    study: null,
    namedSelections: [],
  };
}

export function featureDependencies(feature: CadFeature): string[] {
  switch (feature.kind) {
    case 'extrude':
    case 'revolve':
      return [feature.sketchId];
    case 'boolean':
      return [feature.leftId, feature.rightId];
    case 'fillet':
    case 'chamfer':
    case 'transform':
      return [feature.inputId];
    default:
      return [];
  }
}

/** Definition checks do not assert that an exact kernel shape has been evaluated. */
export function cadDefinitionError(geometry: CadGeometry): string | null {
  if (!geometry.features.length || geometry.features.length > 128)
    return 'A CAD definition needs 1–128 features.';
  if (geometry.assets.length > 32) return 'A project supports at most 32 imported CAD assets.';
  const assets = new Set<string>();
  let totalBytes = 0;
  for (const asset of geometry.assets) {
    if (assets.has(asset.id)) return 'Imported asset identifiers must be unique.';
    assets.add(asset.id);
    totalBytes += asset.byteLength;
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.byteLength) ||
      asset.byteLength < 1 ||
      asset.byteLength > 16 * 1024 * 1024 ||
      totalBytes > 64 * 1024 * 1024
    )
      return 'Imported CAD assets exceed the supported integrity or size bounds.';
  }
  const features = new Set<string>();
  for (const feature of geometry.features) {
    if (!feature.id || features.has(feature.id)) return 'CAD feature identifiers must be unique.';
    if (!feature.name.trim()) return 'Each CAD feature needs a name.';
    if (featureDependencies(feature).some((id) => !features.has(id)))
      return `${feature.name} references a missing or later feature.`;
    if (feature.kind === 'import-step' && !assets.has(feature.assetId))
      return `${feature.name} references a missing imported asset.`;
    const numbers =
      feature.kind === 'box'
        ? [feature.length, feature.width, feature.height]
        : feature.kind === 'cylinder'
          ? [feature.length, feature.radius]
          : feature.kind === 'extrude'
            ? [feature.distance]
            : feature.kind === 'revolve'
              ? [feature.angle, ...feature.axisOrigin, ...feature.axisDirection]
              : feature.kind === 'transform'
                ? [
                    feature.angle,
                    ...feature.translation,
                    ...feature.axisOrigin,
                    ...feature.axisDirection,
                  ]
                : feature.kind === 'fillet'
                  ? [feature.radius]
                  : feature.kind === 'chamfer'
                    ? [feature.distance]
                    : feature.kind === 'import-step'
                      ? [feature.scaleFactor]
                      : [];
    if (numbers.some((value) => !Number.isFinite(value)))
      return `${feature.name} needs finite parameters.`;
    if (
      (feature.kind === 'box' &&
        [feature.length, feature.width, feature.height].some((n) => n <= 0 || n > 1000)) ||
      (feature.kind === 'cylinder' &&
        [feature.length, feature.radius].some((n) => n <= 0 || n > 1000)) ||
      (feature.kind === 'extrude' &&
        (feature.distance === 0 || Math.abs(feature.distance) > 1000)) ||
      (feature.kind === 'revolve' &&
        (feature.angle <= 0 ||
          feature.angle > 2 * Math.PI ||
          Math.hypot(...feature.axisDirection) === 0)) ||
      (feature.kind === 'transform' &&
        (Math.abs(feature.angle) > 2 * Math.PI ||
          Math.hypot(...feature.axisDirection) === 0 ||
          [...feature.translation, ...feature.axisOrigin, ...feature.axisDirection].some(
            (n) => Math.abs(n) > 1000,
          ))) ||
      (feature.kind === 'fillet' && (feature.radius <= 0 || feature.radius > 1000)) ||
      (feature.kind === 'chamfer' && (feature.distance <= 0 || feature.distance > 1000)) ||
      (feature.kind === 'import-step' && feature.scaleFactor <= 0)
    )
      return `${feature.name} has an unsupported parameter range.`;
    features.add(feature.id);
  }
  if (!features.has(geometry.outputFeatureId)) return 'Select an existing CAD output feature.';
  return null;
}

export function documentError(project: ProjectDefinition): string | null {
  const sizeError = documentSizeError(project);
  if (sizeError) return sizeError;
  if (!project.name.trim()) return 'Project name cannot be empty.';
  if (isNumericalProject(project)) return inputError(project);
  if (project.geometry.kind === 'cad') return cadDefinitionError(project.geometry);
  return null;
}

export function documentPreparation(
  project: ProjectDefinition,
  invalidDrafts = 0,
): StudyPreparation {
  const detail = invalidDrafts
    ? 'Complete or revert the active numeric draft.'
    : project.geometry.kind === 'empty'
      ? 'Create or import geometry in the CAD workspace.'
      : 'Evaluate the geometry and review its analysis compatibility in the CAD workspace.';
  const sections = [
    'study',
    'geometry',
    'material',
    'constraints',
    'loads',
    'mesh',
    'solver',
  ] as const;
  return {
    checks: sections.map((section) => ({
      section,
      label: section === 'study' ? 'Study' : section.charAt(0).toUpperCase() + section.slice(1),
      state: invalidDrafts && section === 'geometry' ? 'invalid' : 'missing',
      detail: section === 'geometry' ? detail : 'Analysis has not been created for this geometry.',
    })),
    completed: 0,
    total: sections.length,
    canMesh: false,
    canRun: false,
    restraintRank: 0,
    rigidModes:
      project.geometry.kind === 'empty' || project.geometry.kind === 'cad'
        ? project.geometry.dimension === '2d'
          ? 3
          : 6
        : 6,
    firstMissing: 'geometry',
  };
}
