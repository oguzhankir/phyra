import { describe, expect, it } from 'vitest';
import { planeFitDistance } from './camera';
describe('plane domain camera framing', () => {
  it('fits the physical height with margin in a wide scientific viewport', () => {
    const distance = planeFitDistance(0.1, 0.05, 3, 40);
    const viewHeight = 2 * distance * Math.tan((20 * Math.PI) / 180);
    expect(viewHeight).toBeCloseTo(0.05 * 1.25);
    expect(viewHeight * 3).toBeGreaterThan(0.1);
  });
  it('fits the width when the property panels leave a narrow viewport', () => {
    const distance = planeFitDistance(0.1, 0.05, 0.5, 40);
    const viewWidth = 2 * distance * Math.tan((20 * Math.PI) / 180) * 0.5;
    expect(viewWidth).toBeCloseTo(0.1 * 1.25);
    expect(viewWidth / 0.5).toBeGreaterThan(0.05);
  });
});
