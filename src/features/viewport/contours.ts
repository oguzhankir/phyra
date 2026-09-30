import { Color } from 'three';

const sequential = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'].map(
  (value) => new Color(value),
);
const diverging = ['#3b4cc0', '#8db0fe', '#f3f2ef', '#f4987a', '#b40426'].map(
  (value) => new Color(value),
);

// The same transfer function drives the physical field and its legend.
// Undefined relative differences remain neutral; they must not look like zero error.
export function contourColor(
  value: number,
  minimum: number,
  maximum: number,
  target = new Color(),
): Color {
  if (!Number.isFinite(value)) return target.set('#a4a4a4');
  const signed = minimum < 0 && maximum > 0;
  const palette = signed ? diverging : sequential;
  const fraction = signed
    ? value < 0
      ? 0.5 * (1 - Math.min(1, value / minimum))
      : 0.5 + 0.5 * Math.min(1, value / maximum)
    : maximum === minimum
      ? 0.5
      : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const position = Math.max(0, Math.min(1, fraction)) * (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.floor(position));
  return target.copy(palette[index]).lerp(palette[index + 1], position - index);
}

export function contourGradient(minimum: number, maximum: number): string {
  // Sample in value-space, so zero sits at its actual fraction of an asymmetric range.
  const points = Array.from({ length: 33 }, (_, index) => index / 32);
  if (minimum < 0 && maximum > 0) {
    const zero = -minimum / (maximum - minimum);
    points.push(zero / 2, zero, zero + (1 - zero) / 2);
  }
  const stops = [...new Set(points)]
    .sort((a, b) => a - b)
    .map((fraction) => {
      const value = minimum + fraction * (maximum - minimum);
      const color = contourColor(value, minimum, maximum).getStyle();
      return `${color} ${fraction * 100}%`;
    });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
