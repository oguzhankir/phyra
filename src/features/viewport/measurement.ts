/** Node-to-node Euclidean distance on authoritative, undeformed SI coordinates. */
export function geometryDistance(positions: Float64Array, first: number, second: number): number {
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < 0 ||
    second < 0 ||
    Math.max(first, second) * 3 + 2 >= positions.length
  )
    throw new Error('Measurement nodes are outside the current geometry.');
  const deltas = [0, 1, 2].map(
    (axis) => positions[first * 3 + axis] - positions[second * 3 + axis],
  );
  if (!deltas.every(Number.isFinite)) throw new Error('Measurement coordinates must be finite.');
  const distance = Math.hypot(...deltas);
  if (!Number.isFinite(distance)) throw new Error('Measurement distance must be finite.');
  return distance;
}
