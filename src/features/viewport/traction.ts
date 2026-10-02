import type { Load } from '../../domain/contracts/types';

/** A representative glyph only; the worker owns authoritative quadrature and forces.
 * Kirsch stress convention: DOI 10.1016/j.finel.2026.104523 Appendix B.2.
 */
export function tractionGlyph(
  traction: Load['traction'],
  x: number,
  y: number,
  nx: number,
  ny: number,
): [number, number] | null {
  if (!traction) return null;
  let xx: number, yy: number, xy: number;
  if (traction.kind === 'affine') {
    const affine = (coefficients: [number, number, number]) =>
      coefficients[0] + coefficients[1] * x + coefficients[2] * y;
    xx = affine(traction.xx);
    yy = affine(traction.yy);
    xy = affine(traction.xy);
  } else {
    const dx = x - traction.center[0],
      dy = y - traction.center[1],
      r = Math.hypot(dx, dy);
    if (r === 0) return null;
    const c = dx / r,
      s = dy / r,
      q = (traction.radius / r) ** 2,
      tension = traction.tension;
    const rr = (tension / 2) * (1 - q + (1 - 4 * q + 3 * q * q) * (c * c - s * s));
    const tt = (tension / 2) * (1 + q - (1 + 3 * q * q) * (c * c - s * s));
    const rt = -tension * (1 + 2 * q - 3 * q * q) * s * c;
    xx = rr * c * c + tt * s * s - 2 * rt * s * c;
    yy = rr * s * s + tt * c * c + 2 * rt * s * c;
    xy = (rr - tt) * s * c + rt * (c * c - s * s);
  }
  const vector: [number, number] = [xx * nx + xy * ny, xy * nx + yy * ny];
  return vector.every(Number.isFinite) ? vector : null;
}
