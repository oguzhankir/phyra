import { describe, expect, it } from 'vitest';
import {
  deformationScale,
  displayValue,
  extractField,
  normalizedValue,
  vectorValues,
} from './fields';
import type { ResultData } from './fields';

describe('physical presentation conversions', () => {
  it('converts at the presentation boundary without changing physical values', () => {
    expect(displayValue(0.002, 'm', 'mm')).toEqual({ value: 2, units: 'mm' });
    expect(displayValue(0.002, 'm', 'm')).toEqual({ value: 0.002, units: 'm' });
    expect(displayValue(3e6, 'Pa', 'mm')).toEqual({ value: 3, units: 'MPa' });
  });
  it('computes deformation amplification from displacement independent of the contour field', () => {
    const displacement = new Float64Array([0, 0, 0, 0.003, 0.004, 0]);
    expect(deformationScale(displacement, 2, 'auto', 100)).toBe(48);
    expect(deformationScale(displacement, 2, 'actual', 100)).toBe(1);
    expect(deformationScale(displacement, 2, 'off', 100)).toBe(0);
    expect(deformationScale(new Float64Array(6), 2, 'auto', 100)).toBe(1);
    expect(Array.from(vectorValues(displacement, 'mag'))).toEqual([0, 0.005]);
  });
  it('preserves six cell stress components and uses the physical full-volume range', () => {
    const stress = new Float64Array([1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6]);
    const data = {
      buffer: stress.buffer,
      manifest: {
        operation: 'solve',
        arrays: { stress: { dtype: 'float64', offset: 0, byteLength: stress.byteLength } },
      },
    } as unknown as ResultData;
    const field = extractField(data, 'stress-yz');
    expect(Array.from(field!.values)).toEqual([5, -5]);
    expect(field!.association).toBe('cell');
    expect(field!.minimum).toBe(-5);
    expect(field!.maximum).toBe(5);
    expect(normalizedValue(0, 0, 0)).toBe(0.5);
  });
});
