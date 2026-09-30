import { describe, expect, it } from 'vitest';
import { displayValue } from '../../domain/units';
import { geometryDistance } from './measurement';

describe('undeformed geometry measurement', () => {
  it('recovers an independent 3–4–12 right triangle distance and respects presentation units', () => {
    const positions = new Float64Array([1, 2, 3, 4, 6, 15]);
    const distance = geometryDistance(positions, 0, 1);
    expect(distance).toBe(13);
    expect(geometryDistance(positions, 1, 0)).toBe(13);
    expect(displayValue(distance, 'm', 'mm')).toEqual({ value: 13000, units: 'mm' });
    expect(displayValue(distance, 'm', 'm')).toEqual({ value: 13, units: 'm' });
    expect(Array.from(positions)).toEqual([1, 2, 3, 4, 6, 15]);
  });
  it('reports zero for the same node and rejects invalid or non-finite coordinates', () => {
    const positions = new Float64Array([0, 0, 0, 3, 4, 0]);
    expect(geometryDistance(positions, 1, 1)).toBe(0);
    expect(() => geometryDistance(positions, 0, 2)).toThrow('outside');
    expect(() => geometryDistance(positions, -1, 0)).toThrow('outside');
    expect(() => geometryDistance(positions, 0.5, 0)).toThrow('outside');
    expect(() => geometryDistance(new Float64Array([0, 0, 0, Infinity, 0, 0]), 0, 1)).toThrow(
      'finite',
    );
    expect(() =>
      geometryDistance(new Float64Array([0, 0, 0, 1.7e308, 1.7e308, 1.7e308]), 0, 1),
    ).toThrow('finite');
  });
});
