import { describe, expect, it } from 'vitest';
import { lossDomain } from './TrainingPlot';

describe('actual training loss presentation', () => {
  it('uses logarithmic bounds across measured residual scales', () => {
    expect(lossDomain([{ step: 10, total: 0.34, pde: 0.003, boundary: 0.02 }])).toEqual({
      minimum: -3,
      maximum: 0,
      floor: 0.001,
    });
  });
  it('places measured zero at an explicit lower plotting floor', () => {
    const domain = lossDomain([{ step: 1, total: 1, pde: 0, boundary: 0.01 }]);
    expect(domain.minimum).toBe(-3);
    expect(domain.maximum).toBe(0);
    expect(domain.floor).toBe(0.001);
  });
  it('provides finite plotting bounds when all measured losses are zero', () => {
    expect(lossDomain([{ step: 2, total: 0, pde: 0, boundary: 0 }])).toEqual({
      minimum: -12,
      maximum: 0,
      floor: 1e-12,
    });
  });
});
