import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountContextMenuLifecycle } from './contextMenuLifecycle';

// Exercise the DOM/event boundary without introducing a browser runtime into headless tests.
function environment() {
  let active: ElementNode;
  class ElementNode {
    isConnected = true;
    visible = true;
    disabled = false;
    inert = false;
    children: ElementNode[] = [];
    focus = vi.fn(() => {
      active = this;
    });
    matches() {
      return this.disabled;
    }
    closest() {
      return this.inert ? this : null;
    }
    getClientRects() {
      return this.visible ? [{}] : [];
    }
    contains(node: ElementNode | null) {
      return node === this || this.children.includes(node!);
    }
    querySelector() {
      return this.children.find((node) => !node.disabled) ?? null;
    }
  }
  const body = new ElementNode();
  active = body;
  const modals: ElementNode[] = [];
  const target = new EventTarget();
  const observers: Observer[] = [];
  class Observer {
    disconnected = false;
    constructor(readonly callback: () => void) {
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  vi.stubGlobal('Node', ElementNode);
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', {
    body,
    get activeElement() {
      return active;
    },
    querySelectorAll: () => modals,
  });
  vi.stubGlobal('MutationObserver', Observer);
  const menu = new ElementNode();
  const action = new ElementNode();
  menu.children.push(action);
  const trigger = new ElementNode();
  const fallback = new ElementNode();
  const close = vi.fn();
  let available = true;
  const mount = () =>
    mountContextMenuLifecycle({
      available,
      element: available ? (menu as unknown as HTMLElement) : null,
      onClose: close,
      canRestoreFocus: () => available,
      restoreFocus: trigger as unknown as HTMLElement,
      fallbackFocus: () => fallback as unknown as HTMLElement,
    });
  return {
    action,
    trigger,
    fallback,
    body,
    close,
    mount,
    active: () => active,
    deactivate: () => {
      available = false;
    },
    showModal: (visible = true) => {
      const modal = new ElementNode();
      modal.visible = visible;
      modals.push(modal);
      for (const observer of observers) if (!observer.disconnected) observer.callback();
      return modal;
    },
    dispatch: (type: string, node = body) => {
      const event = new Event(type);
      Object.defineProperty(event, 'target', { value: node });
      target.dispatchEvent(event);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('portaled context menu lifecycle', () => {
  it('closes on document deactivation without moving focus back into the hidden tree', async () => {
    const env = environment();
    const release = env.mount();
    expect(env.active()).toBe(env.action);
    env.deactivate();
    env.body.focus();
    release();
    const releaseInactive = env.mount();
    await Promise.resolve();
    expect(env.close).toHaveBeenCalledOnce();
    expect(env.trigger.focus).not.toHaveBeenCalled();
    expect(env.fallback.focus).not.toHaveBeenCalled();
    expect(env.active()).toBe(env.body);
    releaseInactive();
  });

  it.each(['model tree', 'viewport'])(
    '%s menu yields focus when Help or another modal opens',
    async () => {
      const env = environment();
      const release = env.mount();
      const modal = env.showModal();
      modal.focus();
      expect(env.close).toHaveBeenCalledOnce();
      release();
      await Promise.resolve();
      expect(env.active()).toBe(modal);
      expect(env.trigger.focus).not.toHaveBeenCalled();
    },
  );

  it('does not mount or steal focus when a modal is already visible', () => {
    const env = environment();
    const modal = env.showModal();
    modal.focus();
    env.mount()();
    expect(env.close).toHaveBeenCalledOnce();
    expect(env.active()).toBe(modal);
    expect(env.action.focus).not.toHaveBeenCalled();
  });

  it('ignores hidden document dialogs and restores the trigger on ordinary dismissal', () => {
    const env = environment();
    const release = env.mount();
    env.showModal(false);
    expect(env.close).not.toHaveBeenCalled();
    release();
    expect(env.active()).toBe(env.trigger);
  });

  it('focuses the current model item after a delete removes its original trigger', async () => {
    const env = environment();
    const release = env.mount();
    release();
    env.trigger.isConnected = false;
    env.body.focus();
    await Promise.resolve();
    expect(env.active()).toBe(env.fallback);
  });

  it('dismisses outside/resize events and removes all observers on unmount', () => {
    const env = environment();
    const release = env.mount();
    env.dispatch('pointerdown', env.action);
    expect(env.close).not.toHaveBeenCalled();
    env.dispatch('pointerdown');
    env.dispatch('resize');
    expect(env.close).toHaveBeenCalledTimes(2);
    release();
    env.dispatch('resize');
    env.dispatch('pointerdown');
    env.showModal();
    expect(env.close).toHaveBeenCalledTimes(2);
  });
});
