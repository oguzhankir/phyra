import type { RegionId } from '../../domain/project/regions';

export type SelectionMode = 'replace' | 'add' | 'toggle';

export function selectionIntent(
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  mode: SelectionMode,
): SelectionMode {
  if (modifiers.ctrlKey || modifiers.metaKey) return 'toggle';
  if (modifiers.shiftKey) return 'add';
  return mode;
}

/** A blank replace click clears the selection; additive blank clicks preserve it. */
export function nextSelection(
  selected: readonly RegionId[],
  region: RegionId | null,
  mode: SelectionMode,
): RegionId[] {
  if (region === null) return mode === 'replace' ? [] : [...selected];
  if (mode === 'replace') return [region];
  if (selected.includes(region))
    return mode === 'toggle' ? selected.filter((value) => value !== region) : [...selected];
  return [...selected, region];
}
