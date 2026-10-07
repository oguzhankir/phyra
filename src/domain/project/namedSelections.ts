import type { ProjectDefinition as Project } from '../contracts/types';
import { isNumericalProject } from './document';
import { isCadSolidProject } from './cadSolid';
import { projectRegions, type RegionId } from './regions';
import { selectionNameKey } from './selectionNames';
export { selectionNameKey } from './selectionNames';

export type NamedSelection = Project['namedSelections'][number];

export function selectionIsCompatible(project: Project, selection: NamedSelection): boolean {
  if (!isNumericalProject(project) && !isCadSolidProject(project)) return false;
  const available = new Set(projectRegions(project).map(({ id }) => id));
  return (
    selection.geometryKind === project.geometry.kind &&
    selection.dimension === project.study.dimension &&
    (isCadSolidProject(project)
      ? selection.geometryFingerprint === project.study.domain.geometryFingerprint
      : selection.geometryFingerprint === undefined) &&
    selection.regions.length > 0 &&
    selection.regions.every((region) => available.has(region))
  );
}

export function namedSelectionError(project: Project): string | null {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const selection of project.namedSelections) {
    if (
      selection.geometryKind === 'cad'
        ? selection.dimension !== '3d' ||
          selection.geometryFingerprint?.length !== 64 ||
          !/^[a-f0-9]{64}$/.test(selection.geometryFingerprint ?? '')
        : selection.geometryFingerprint !== undefined
    )
      return 'CAD boundary sets require a 3D source fingerprint; primitive sets cannot carry one.';
    const name = selectionNameKey(selection.name);
    if (!name) return 'Named selection names cannot be empty.';
    if (names.has(name)) return 'Named selection names must be unique.';
    if (ids.has(selection.id)) return 'Named selection identifiers must be unique.';
    names.add(name);
    ids.add(selection.id);
  }
  return null;
}

export function nextSelectionName(project: Project): string {
  const names = new Set(project.namedSelections.map((item) => selectionNameKey(item.name)));
  let index = 1;
  while (names.has(selectionNameKey(`Boundary set ${index}`))) index++;
  return `Boundary set ${index}`;
}

export function selectedBoundaries(project: Project, regions: readonly RegionId[]): RegionId[] {
  if (!isNumericalProject(project) && !isCadSolidProject(project)) return [];
  const chosen = new Set(regions);
  return projectRegions(project)
    .map(({ id }) => id)
    .filter((id) => chosen.has(id));
}
