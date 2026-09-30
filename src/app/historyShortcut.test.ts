import { describe, expect, it } from 'vitest';
import { historyShortcut } from './historyShortcut';

function element(
  tagName: string,
  attributes: Record<string, string> = {},
  parentElement: EventTarget | null = null,
): EventTarget {
  return {
    tagName,
    parentElement,
    getAttribute: (name: string) => attributes[name] ?? null,
  } as unknown as EventTarget;
}
function key(overrides: Partial<Parameters<typeof historyShortcut>[0]> = {}) {
  return {
    key: 'z',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: element('BUTTON'),
    ...overrides,
  };
}

describe('native model history shortcuts', () => {
  it('uses the macOS command chord and its shifted redo chord', () => {
    expect(historyShortcut(key({ metaKey: true }), { platform: 'mac', blocked: false })).toBe(
      'undo',
    );
    expect(
      historyShortcut(key({ key: 'Z', metaKey: true, shiftKey: true }), {
        platform: 'mac',
        blocked: false,
      }),
    ).toBe('redo');
    expect(historyShortcut(key({ ctrlKey: true }), { platform: 'mac', blocked: false })).toBeNull();
    expect(
      historyShortcut(key({ key: 'y', metaKey: true }), { platform: 'mac', blocked: false }),
    ).toBeNull();
  });
  it('supports Windows control undo and both native redo chords', () => {
    const circumstances = { platform: 'windows', blocked: false } as const;
    expect(historyShortcut(key({ ctrlKey: true }), circumstances)).toBe('undo');
    expect(historyShortcut(key({ ctrlKey: true, shiftKey: true }), circumstances)).toBe('redo');
    expect(historyShortcut(key({ key: 'y', ctrlKey: true }), circumstances)).toBe('redo');
    expect(
      historyShortcut(key({ key: 'y', ctrlKey: true, shiftKey: true }), circumstances),
    ).toBeNull();
    expect(historyShortcut(key({ metaKey: true }), circumstances)).toBeNull();
  });
  it('uses control Z / shifted Z on other platforms without assuming Windows Y', () => {
    const circumstances = { platform: 'other', blocked: false } as const;
    expect(historyShortcut(key({ ctrlKey: true }), circumstances)).toBe('undo');
    expect(historyShortcut(key({ ctrlKey: true, shiftKey: true }), circumstances)).toBe('redo');
    expect(historyShortcut(key({ key: 'y', ctrlKey: true }), circumstances)).toBeNull();
  });
  it.each([
    { defaultPrevented: true },
    { isComposing: true },
    { altKey: true },
    { metaKey: true },
    { ctrlKey: false },
    { key: 's' },
  ])('leaves consumed, composing or noncanonical events alone: %j', (override) => {
    expect(
      historyShortcut(key({ ctrlKey: true, ...override }), {
        platform: 'windows',
        blocked: false,
      }),
    ).toBeNull();
  });
  it('never dispatches global history while a modal, operation or invalid draft blocks it', () => {
    expect(
      historyShortcut(key({ ctrlKey: true }), { platform: 'windows', blocked: true }),
    ).toBeNull();
  });
});

describe('preserving native text undo', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('preserves editing inside %s', (tagName) => {
    expect(
      historyShortcut(key({ ctrlKey: true, target: element(tagName) }), {
        platform: 'windows',
        blocked: false,
      }),
    ).toBeNull();
  });
  it.each(['', 'true', 'plaintext-only', 'TRUE'])(
    'preserves contenteditable=%j descendants',
    (value) => {
      const parent = element('DIV', { contenteditable: value });
      const target = element('SPAN', {}, element('STRONG', {}, parent));
      expect(
        historyShortcut(key({ metaKey: true, target }), { platform: 'mac', blocked: false }),
      ).toBeNull();
    },
  );
  it('allows workbench history for explicit noneditable content outside an editor', () => {
    const target = element('SPAN', {}, element('DIV', { contenteditable: 'false' }));
    expect(
      historyShortcut(key({ metaKey: true, target }), { platform: 'mac', blocked: false }),
    ).toBe('undo');
  });
  it('leaves a noneditable island inside an editor to its enclosing editor', () => {
    const editor = element('DIV', { contenteditable: 'true' });
    const target = element('SPAN', { contenteditable: 'false' }, editor);
    expect(
      historyShortcut(key({ metaKey: true, target }), { platform: 'mac', blocked: false }),
    ).toBeNull();
  });
  it('preserves custom textbox descendants while allowing canvas and toolbar history', () => {
    const target = element('SPAN', {}, element('DIV', { role: 'textbox' }));
    const circumstances = { platform: 'windows', blocked: false } as const;
    expect(historyShortcut(key({ ctrlKey: true, target }), circumstances)).toBeNull();
    expect(historyShortcut(key({ ctrlKey: true, target: element('CANVAS') }), circumstances)).toBe(
      'undo',
    );
    expect(historyShortcut(key({ ctrlKey: true, target: null }), circumstances)).toBe('undo');
  });
});
