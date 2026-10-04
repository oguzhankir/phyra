import { afterEach, expect, it, vi } from 'vitest';
import { mountDetailDialogOwnership } from './detailDialogLifecycle';

afterEach(() => vi.unstubAllGlobals());

it('copies native fieldset disabled state into portaled controls and updates on worker locking', () => {
  let refresh = () => {};
  let stopped = false;
  class Observer {
    constructor(callback: () => void) {
      refresh = () => {
        if (!stopped) callback();
      };
    }
    observe() {}
    disconnect() {
      stopped = true;
    }
  }
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('MutationObserver', Observer);
  let disabled = true;
  let hidden = false;
  const trigger = {
    isConnected: true,
    closest: () => (hidden ? {} : null),
    matches: () => disabled,
  };
  const onDisabled = vi.fn();
  const onHide = vi.fn();
  const release = mountDetailDialogOwnership({
    trigger: trigger as unknown as HTMLElement,
    onDisabled,
    onHide,
  });
  expect(onDisabled).toHaveBeenLastCalledWith(true);
  disabled = false;
  refresh();
  expect(onDisabled).toHaveBeenLastCalledWith(false);
  disabled = true;
  refresh();
  expect(onDisabled).toHaveBeenLastCalledWith(true);
  hidden = true;
  refresh();
  expect(onHide).toHaveBeenCalledOnce();
  release();
  refresh();
  expect(onHide).toHaveBeenCalledOnce();
});
