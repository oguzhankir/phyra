export type CadSelectionScope = 'model' | 'inspection' | 'none';

/** Inspection and provisional views must never dispatch authored-model selection changes. */
export function cadSelectionScope({
  hasPreview,
  stale,
  provisional,
  inspection,
  canInspect,
}: {
  hasPreview: boolean;
  stale: boolean;
  provisional: boolean;
  inspection: boolean;
  canInspect: boolean;
}): CadSelectionScope {
  if (!hasPreview || stale || provisional) return 'none';
  return inspection ? (canInspect ? 'inspection' : 'none') : 'model';
}

export function publishCadSelection(
  scope: CadSelectionScope,
  id: string | null,
  additive: boolean,
  callbacks: {
    onSelect: (id: string, additive: boolean) => void;
    onClearSelection: () => void;
    onInspectionSelect?: (id: string | null) => void;
  },
) {
  if (scope === 'inspection') callbacks.onInspectionSelect?.(id);
  else if (scope === 'model') {
    if (id) callbacks.onSelect(id, additive);
    else if (!additive) callbacks.onClearSelection();
  }
}
