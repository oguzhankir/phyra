import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('workbench theme preference', () => {
  it('keeps explicit light mode independent of the operating system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('follows the operating system only when explicitly selected', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
