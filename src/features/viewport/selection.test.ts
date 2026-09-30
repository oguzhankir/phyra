import { describe, expect, it } from 'vitest';
import { nextSelection, selectionIntent } from './selection';

describe('boundary selection intent', () => {
  it('replaces on an ordinary click and clears on an ordinary blank click', () => {
    expect(nextSelection(['x0', 'y0'], 'x1', 'replace')).toEqual(['x1']);
    expect(nextSelection(['x0'], null, 'replace')).toEqual([]);
  });
  it('adds once, preserves additive blank clicks, and toggles membership without mutating input', () => {
    const original = ['x0', 'y0'] as const;
    expect(nextSelection(original, 'x0', 'add')).toEqual(['x0', 'y0']);
    expect(nextSelection(original, 'x1', 'add')).toEqual(['x0', 'y0', 'x1']);
    expect(nextSelection(original, null, 'add')).toEqual(original);
    expect(nextSelection(original, 'x0', 'toggle')).toEqual(['y0']);
    expect(original).toEqual(['x0', 'y0']);
  });
  it('honors modifiers over the controlled mode and gives Ctrl/Cmd toggle precedence', () => {
    expect(selectionIntent({ shiftKey: false, ctrlKey: false, metaKey: false }, 'add')).toBe('add');
    expect(selectionIntent({ shiftKey: true, ctrlKey: false, metaKey: false }, 'replace')).toBe(
      'add',
    );
    expect(selectionIntent({ shiftKey: true, ctrlKey: true, metaKey: false }, 'replace')).toBe(
      'toggle',
    );
    expect(selectionIntent({ shiftKey: false, ctrlKey: false, metaKey: true }, 'replace')).toBe(
      'toggle',
    );
  });
});
