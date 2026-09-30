import { describe, expect, it } from 'vitest';
import { contourColor, contourGradient } from './contours';

describe('scientific transfer function', () => {
  it('preserves distinct endpoints and clamps values to the displayed interval', () => {
    expect(contourColor(-1, 0, 10).getHexString()).toBe('440154');
    expect(contourColor(12, 0, 10).getHexString()).toBe('fde725');
    expect(contourColor(0, 0, 10).getHexString()).not.toBe(contourColor(10, 0, 10).getHexString());
  });

  it('places physical zero at the neutral diverging color for an asymmetric range', () => {
    expect(contourColor(-2, -2, 8).getHexString()).toBe('3b4cc0');
    expect(contourColor(0, -2, 8).getHexString()).toBe('f3f2ef');
    expect(contourColor(8, -2, 8).getHexString()).toBe('b40426');
    expect(contourGradient(-2, 8)).toContain(`${contourColor(0, -2, 8).getStyle()} 20%`);
  });

  it('distinguishes undefined values from zero and handles constant fields', () => {
    expect(contourColor(NaN, 0, 1).getHexString()).toBe('a4a4a4');
    expect(contourColor(0, 0, 1).getHexString()).not.toBe('a4a4a4');
    expect(contourGradient(5, 5)).not.toMatch(/NaN|Infinity/);
  });
});
