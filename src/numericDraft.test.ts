import { describe, expect, it } from 'vitest';
import { parseNumericDraft } from './numericDraft';

describe('numeric drafts at the physical input boundary', () => {
  it.each([
    '',
    ' ',
    '-',
    '+',
    '.',
    '1e',
    '1e-',
    '1e+',
    'Infinity',
    'NaN',
    '1e999',
    '0x20',
    '1,000',
  ])('keeps %j invalid until explicitly completed or reverted', (text) => {
    expect(parseNumericDraft(text)).toBeNull();
  });
  it.each([
    ['1e-3', 0.001],
    ['+2.5E+2', 250],
    ['-.25', -0.25],
    ['0', 0],
    ['12.', 12],
    [' 4.2 ', 4.2],
  ] as const)('accepts the complete finite draft %s', (text, value) => {
    expect(parseNumericDraft(text)).toBe(value);
  });
  it('does not overwrite a previous canonical value with an incomplete exponent', () => {
    let canonical = 12;
    for (const text of ['1', '1e', '1e-', '1e-3']) {
      const parsed = parseNumericDraft(text);
      if (parsed !== null) canonical = parsed;
      if (text === '1e' || text === '1e-') expect(canonical).toBe(1);
    }
    expect(canonical).toBe(0.001);
    expect(parseNumericDraft(String(canonical))).toBe(canonical);
  });
});
