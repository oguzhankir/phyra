import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterSelectOptions,
  mountSelectPopover,
  nextSelectOption,
  selectPopoverPosition,
} from './selectPopover';

const options = [
  { value: 'a', label: 'Alpha', group: 'Connected provider', description: 'Quick responses' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma', group: 'Local', description: 'Private endpoint' },
];

describe('select options and viewport bounds', () => {
  it('searches all supplied terms across model names, descriptions and provider groups', () => {
    expect(filterSelectOptions(options, 'connected quick').map((option) => option.value)).toEqual([
      'a',
    ]);
    expect(filterSelectOptions(options, '  LOCAL private  ').map((option) => option.value)).toEqual(
      ['c'],
    );
    expect(filterSelectOptions(options, 'missing')).toEqual([]);
  });
  it('wraps keyboard navigation and skips disabled options', () => {
    expect(nextSelectOption(options, 'a', 'ArrowDown')).toBe('c');
    expect(nextSelectOption(options, 'a', 'ArrowUp')).toBe('c');
    expect(nextSelectOption(options, 'c', 'ArrowDown')).toBe('a');
    expect(nextSelectOption(options, null, 'ArrowUp')).toBe('c');
    expect(nextSelectOption(options, 'c', 'Home')).toBe('a');
    expect(nextSelectOption(options, 'a', 'End')).toBe('c');
    expect(
      nextSelectOption([{ value: 'disabled', label: 'Disabled', disabled: true }], null, 'Home'),
    ).toBeNull();
  });
  it('opens upwards near the bottom and bounds width against the viewport', () => {
    expect(
      selectPopoverPosition(
        { left: 750, top: 550, bottom: 580, width: 220 },
        { width: 800, height: 600 },
        250,
      ),
    ).toEqual({ left: 572, top: 294, width: 220, maxHeight: 320 });
    expect(
      selectPopoverPosition(
        { left: 0, top: 10, bottom: 35, width: 350 },
        { width: 180, height: 200 },
        300,
      ),
    ).toEqual({ left: 8, top: 41, width: 164, maxHeight: 151 });
  });
});

function environment(inModal = false) {
  let active: ElementNode;
  class ElementNode {
    parent: ElementNode | null = null;
    isConnected = true;
    hidden = false;
    disabled = false;
    modal = false;
    focus = vi.fn(() => {
      active = this;
    });
    contains(node: ElementNode | null) {
      for (let current = node; current; current = current.parent) if (current === this) return true;
      return false;
    }
    closest(selector: string): ElementNode | null {
      for (let current: ElementNode | null = this; current; current = current.parent) {
        if (selector.includes('aria-modal') ? current.modal : current.hidden) return current;
      }
      return null;
    }
    matches() {
      return this.disabled;
    }
    getClientRects() {
      return this.closest('[hidden], [inert]') ? [] : [{}];
    }
  }
  const body = new ElementNode();
  active = body;
  const trigger = new ElementNode();
  const popup = new ElementNode();
  const input = new ElementNode();
  input.parent = popup;
  const owner = new ElementNode();
  trigger.parent = owner;
  owner.modal = inModal;
  const modals = inModal ? [owner] : [];
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
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const window = Object.assign(new EventTarget(), {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  vi.stubGlobal('Node', ElementNode);
  vi.stubGlobal('MutationObserver', Observer);
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', {
    body,
    get activeElement() {
      return active;
    },
    querySelectorAll: () => modals,
  });
  const close = vi.fn();
  const position = vi.fn();
  return {
    trigger,
    popup,
    input,
    owner,
    close,
    position,
    active: () => active,
    frame: () => {
      for (const [id, callback] of frames) {
        frames.delete(id);
        callback(0);
      }
    },
    mount: () =>
      mountSelectPopover({
        trigger: trigger as unknown as HTMLElement,
        popover: popup as unknown as HTMLElement,
        focusTarget: input as unknown as HTMLElement,
        onClose: close,
        onPosition: position,
      }),
    change: () =>
      observers.forEach((observer) => {
        if (!observer.disconnected) observer.callback();
      }),
    addModal: () => {
      const modal = new ElementNode();
      modal.modal = true;
      modals.push(modal);
      return modal;
    },
    outside: () => new ElementNode(),
    dispatch: (type: string, node = body) => {
      const event = new Event(type);
      Object.defineProperty(event, 'target', { value: node });
      window.dispatchEvent(event);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('portaled select lifecycle', () => {
  it('focuses inside its owning dialog and restores the visible trigger on dismissal', () => {
    const env = environment(true);
    const release = env.mount();
    env.frame();
    expect(env.close).not.toHaveBeenCalled();
    expect(env.active()).toBe(env.input);
    expect(env.position).toHaveBeenCalledOnce();
    release();
    expect(env.active()).toBe(env.trigger);
  });
  it('repositions on resize and scroll without closing, and removes all listeners', () => {
    const env = environment();
    const release = env.mount();
    env.dispatch('scroll');
    env.dispatch('resize');
    env.dispatch('pointerdown', env.input);
    expect(env.position).toHaveBeenCalledTimes(3);
    expect(env.close).not.toHaveBeenCalled();
    release();
    env.dispatch('resize');
    env.dispatch('pointerdown');
    env.change();
    expect(env.position).toHaveBeenCalledTimes(3);
    expect(env.close).not.toHaveBeenCalled();
  });
  it('does not steal focus back from a pointer or keyboard destination', () => {
    const env = environment();
    const release = env.mount();
    env.frame();
    const outside = env.outside();
    env.dispatch('pointerdown', outside);
    outside.focus();
    env.dispatch('focusin', outside);
    expect(env.close).toHaveBeenCalledTimes(2);
    release();
    expect(env.active()).toBe(outside);
    expect(env.trigger.focus).not.toHaveBeenCalled();
  });
  it('closes when its document hides without restoring focus to a hidden tab', () => {
    const env = environment();
    const release = env.mount();
    env.owner.hidden = true;
    env.change();
    expect(env.close).toHaveBeenCalledOnce();
    release();
    expect(env.trigger.focus).not.toHaveBeenCalled();
  });
  it('yields ownership to a newly opened dialog', () => {
    const env = environment(true);
    const release = env.mount();
    env.frame();
    const modal = env.addModal();
    env.change();
    modal.focus();
    expect(env.close).toHaveBeenCalledOnce();
    release();
    expect(env.active()).toBe(modal);
    expect(env.trigger.focus).not.toHaveBeenCalled();
  });
  it('does not mount for an unavailable trigger or a different modal owner', () => {
    const env = environment();
    env.trigger.disabled = true;
    env.mount()();
    expect(env.close).toHaveBeenCalledOnce();
    expect(env.input.focus).not.toHaveBeenCalled();
    env.trigger.disabled = false;
    env.addModal();
    env.mount()();
    expect(env.close).toHaveBeenCalledTimes(2);
  });
  it('focuses after native click activation and cancels pending focus on unmount', () => {
    const env = environment();
    let release = env.mount();
    env.trigger.focus();
    expect(env.active()).toBe(env.trigger);
    env.frame();
    expect(env.active()).toBe(env.input);
    release();
    env.input.focus.mockClear();
    release = env.mount();
    release();
    env.frame();
    expect(env.input.focus).not.toHaveBeenCalled();
  });
});
