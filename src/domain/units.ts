import type { Project } from './contracts/types';

export function lengthFactor(units: Project['displayUnits']): number {
  return units === 'mm' ? 1000 : 1;
}
export function displayValue(
  value: number,
  units: string,
  displayUnits: Project['displayUnits'],
): { value: number; units: string } {
  if (units === 'm') return { value: value * lengthFactor(displayUnits), units: displayUnits };
  if (units === 'Pa') return { value: value / 1e6, units: 'MPa' };
  return { value, units };
}
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return Math.abs(value) < 0.001 || Math.abs(value) >= 100000
    ? value.toExponential(3)
    : new Intl.NumberFormat('en', { maximumSignificantDigits: 5 }).format(value);
}
