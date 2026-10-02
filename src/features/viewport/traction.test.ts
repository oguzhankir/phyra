import { describe, expect, it } from 'vitest';
import { tractionGlyph } from './traction';

describe('representative traction glyphs', () => {
  it('uses global metre coordinates and the outward material normal for affine vector traction', () => {
    const traction = {
      kind: 'affine' as const,
      xx: [2, 3, 0] as [number, number, number],
      yy: [5, 0, -1] as [number, number, number],
      xy: [1, 0, 0] as [number, number, number],
    };
    expect(tractionGlyph(traction, 2, 4, 1, 0)).toEqual([8, 1]);
    expect(tractionGlyph(traction, 2, 4, 0, -1)).toEqual([-1, -1]);
  });
  it('shows a free Kirsch hole and the 3T tangential concentration, omitting the undefined center', () => {
    const traction = {
      kind: 'kirsch' as const,
      radius: 1,
      center: [0, 0] as [number, number],
      tension: 2,
    };
    expect(tractionGlyph(traction, 0, 1, 0, -1)).toEqual([0, 0]);
    expect(tractionGlyph(traction, 0, 1, 1, 0)).toEqual([6, 0]);
    expect(tractionGlyph(traction, 0, 0, 1, 0)).toBe(null);
  });
});
