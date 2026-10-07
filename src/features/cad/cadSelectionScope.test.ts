import { describe, expect, it, vi } from 'vitest';
import { cadSelectionScope, publishCadSelection } from './cadSelectionScope';

describe('CAD and inspection selection ownership', () => {
  const inputs = {
    hasPreview: true,
    stale: false,
    provisional: false,
    inspection: false,
    canInspect: true,
  };
  const callbacks = () => ({
    onSelect: vi.fn(),
    onClearSelection: vi.fn(),
    onInspectionSelect: vi.fn(),
  });

  it('routes ordinary picks and clearing only to the authored model', () => {
    const actions = callbacks();
    const scope = cadSelectionScope(inputs);
    publishCadSelection(scope, 'cad-face-1', true, actions);
    publishCadSelection(scope, null, true, actions);
    publishCadSelection(scope, null, false, actions);
    expect(actions.onSelect).toHaveBeenCalledExactlyOnceWith('cad-face-1', true);
    expect(actions.onClearSelection).toHaveBeenCalledTimes(1);
    expect(actions.onInspectionSelect).not.toHaveBeenCalled();
  });

  it('keeps mesh and exact-face inspection picks outside authored selection', () => {
    for (const id of ['mesh-job-boundary-4', 'cad-face-1']) {
      const actions = callbacks();
      const scope = cadSelectionScope({ ...inputs, inspection: true });
      publishCadSelection(scope, id, true, actions);
      publishCadSelection(scope, null, false, actions);
      expect(actions.onInspectionSelect.mock.calls).toEqual([[id], [null]]);
      expect(actions.onSelect).not.toHaveBeenCalled();
      expect(actions.onClearSelection).not.toHaveBeenCalled();
    }
  });

  it.each([
    { provisional: true },
    { provisional: true, inspection: true },
    { stale: true },
    { hasPreview: false },
    { inspection: true, canInspect: false },
  ])('rejects picking and clearing for unavailable topology: %o', (unavailable) => {
    const actions = callbacks();
    const scope = cadSelectionScope({ ...inputs, ...unavailable });
    expect(scope).toBe('none');
    publishCadSelection(scope, 'cad-face-1', false, actions);
    publishCadSelection(scope, null, false, actions);
    expect(actions.onSelect).not.toHaveBeenCalled();
    expect(actions.onClearSelection).not.toHaveBeenCalled();
    expect(actions.onInspectionSelect).not.toHaveBeenCalled();
  });
});
