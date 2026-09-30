import { describe, expect, it } from 'vitest';
import {
  deformationScale,
  deformationPhase,
  displayValue,
  extractField,
  normalizedValue,
  vectorValues,
  regionNames,
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

describe('matched Physics ML field presentation', () => {
  const values = new Float64Array([0, 0, 0, 3, 4, 0, 1, 0, 0, 6, 8, 0]);
  const data = {
    buffer: values.buffer,
    manifest: {
      operation: 'compare',
      arrays: {
        displacement: { dtype: 'float64', offset: 0, byteLength: 48 },
        pinnDisplacement: { dtype: 'float64', offset: 48, byteLength: 48 },
      },
    },
  } as unknown as ResultData;
  it('uses identical nodes and vector differences rather than magnitude subtraction', () => {
    expect(Array.from(extractField(data, 'displacement-mag', 'pinn')!.values)).toEqual([1, 10]);
    expect(Array.from(extractField(data, 'displacement-mag', 'difference')!.values)).toEqual([
      1, 5,
    ]);
    const relative = extractField(data, 'displacement-mag', 'relative')!;
    expect(Number.isNaN(relative.values[0])).toBe(true);
    expect(relative.values[1]).toBe(100);
    expect(relative.units).toBe('%');
    expect(relative.minimum).toBe(100);
  });
  it('cycles only the visualization factor from zero to maximum and back', () => {
    expect(deformationPhase(0)).toBe(0);
    expect(deformationPhase(2000)).toBe(1);
    expect(deformationPhase(4000)).toBe(0);
    expect(deformationPhase(1000)).toBeCloseTo(0.5);
    expect(Array.from(values)).toEqual([0, 0, 0, 3, 4, 0, 1, 0, 0, 6, 8, 0]);
  });
  it('omits undefined zero-reference ratios, including 0/0, while preserving defined zero error', () => {
    const equal = new Float64Array([0, 0, 0, 3, 4, 0, 0, 0, 0, 3, 4, 0]);
    const result = { ...data, buffer: equal.buffer };
    const relative = extractField(result, 'displacement-mag', 'relative')!;
    expect(Number.isNaN(relative.values[0])).toBe(true);
    expect(relative.values[1]).toBe(0);
    expect(relative.finiteCount).toBe(1);
    const zero = extractField(
      { ...data, buffer: new Float64Array(12).buffer },
      'displacement-mag',
      'relative',
    )!;
    expect(zero.values.every(Number.isNaN)).toBe(true);
    expect(zero.finiteCount).toBe(0);
  });
  it('exposes only true 2D edges for planar assignment', () => {
    expect(regionNames('box', '2d').map((region) => region.id)).toEqual(['x0', 'x1', 'y0', 'y1']);
  });
});
