import type { ProjectDefinition as Project } from '../contracts/types';
import { isNumericalProject } from './document';
import { regionNames, type RegionId } from './regions';

export type NamedSelection = Project['namedSelections'][number];

// ASCII case folding is identical in the native/Python validators and does not
// depend on the user's locale. Non-ASCII labels retain their authored identity.
export function selectionNameKey(name: string): string {
  // Explicit shared whitespace policy, including BOM and separator controls;
  // JS trim(), Python strip() and Rust trim() do not recognize identical sets.
  const whitespace =
    '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
  return name
    .replace(new RegExp(`^${whitespace}+|${whitespace}+$`, 'g'), '')
    .replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function selectionIsCompatible(project: Project, selection: NamedSelection): boolean {
  if (!isNumericalProject(project)) return false;
  const available = new Set(
    regionNames(project.geometry.kind, project.study.dimension, project.geometry.profile).map(
      ({ id }) => id,
    ),
  );
  return (
    selection.geometryKind === project.geometry.kind &&
    selection.dimension === project.study.dimension &&
    selection.regions.length > 0 &&
    selection.regions.every((region) => available.has(region))
  );
}

export function namedSelectionError(project: Project): string | null {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const selection of project.namedSelections) {
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
  if (!isNumericalProject(project)) return [];
  const chosen = new Set(regions);
  return regionNames(project.geometry.kind, project.study.dimension, project.geometry.profile)
    .map(({ id }) => id)
    .filter((id) => chosen.has(id));
}
