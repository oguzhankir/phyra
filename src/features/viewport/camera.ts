/** Perspective framing of an XY domain with 25% margin; camera-only, no physical rescaling. */
export function planeFitDistance(
  width: number,
  height: number,
  aspect: number,
  verticalFovDegrees: number,
): number {
  const tangent = Math.tan((verticalFovDegrees * Math.PI) / 360);
  return (
    1.25 * Math.max(width / (2 * tangent * Math.max(aspect, 1e-6)), height / (2 * tangent), 1e-6)
  );
}
