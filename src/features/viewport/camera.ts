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

export type CameraView = 'isometric' | 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

/** Engineering convention: Z is vertical; front looks along +Y, top along −Z. */
export function cameraOrientation(view: CameraView): {
  direction: [number, number, number];
  up: [number, number, number];
} {
  if (view === 'top') return { direction: [0, 0, 1], up: [0, 1, 0] };
  if (view === 'bottom') return { direction: [0, 0, -1], up: [0, -1, 0] };
  const directions: Record<Exclude<CameraView, 'top' | 'bottom'>, [number, number, number]> = {
    isometric: [1.3, -1.8, 1.3],
    front: [0, -1, 0],
    back: [0, 1, 0],
    right: [1, 0, 0],
    left: [-1, 0, 0],
  };
  return { direction: directions[view], up: [0, 0, 1] };
}

/** Fits a bounding sphere in both frustum directions with 25% margin. */
export function solidFitDistance(
  radius: number,
  aspect: number,
  verticalFovDegrees: number,
): number {
  const vertical = (verticalFovDegrees * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 1e-6));
  return (1.25 * Math.max(radius, 1e-6)) / Math.sin(Math.min(vertical, horizontal));
}

/** Fits every bounding-box corner in the chosen perspective orientation.
 * For corner c relative to the target, depth = distance − dot(c, direction).
 * Each frustum inequality gives distance ≥ projected-depth + padded extent / tan(FOV).
 * Taking their maximum avoids the empty-space penalty of sphere framing on slender parts.
 */
export function boxFitDistance(
  span: [number, number, number],
  direction: [number, number, number],
  up: [number, number, number],
  aspect: number,
  verticalFovDegrees: number,
): number {
  const dot = (a: number[], b: number[]) =>
    a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (value: number[]) => value.map((component) => component / Math.hypot(...value));
  const outward = normalize(direction);
  const rawRight = cross(up, outward);
  if (Math.hypot(...rawRight) === 0 || !outward.every(Number.isFinite))
    return solidFitDistance(Math.hypot(...span) / 2, aspect, verticalFovDegrees);
  const right = normalize(rawRight);
  const vertical = cross(outward, right);
  const tangent = Math.tan((verticalFovDegrees * Math.PI) / 360);
  let distance = 1e-6;
  let frontDepth = -Infinity;
  for (const x of [-span[0] / 2, span[0] / 2])
    for (const y of [-span[1] / 2, span[1] / 2])
      for (const z of [-span[2] / 2, span[2] / 2]) {
        const corner = [x, y, z];
        const depth = dot(corner, outward);
        frontDepth = Math.max(frontDepth, depth);
        distance = Math.max(
          distance,
          depth +
            1.25 *
              Math.max(
                Math.abs(dot(corner, right)) / (tangent * Math.max(aspect, 1e-6)),
                Math.abs(dot(corner, vertical)) / tangent,
              ),
        );
      }
  return Math.max(distance, frontDepth + Math.max(Math.hypot(...span), 1e-6) / 5000);
}

/** Keep the current zoom relative to the fitted model when the viewport's aspect changes.
 * Applying this factor to the camera-to-target offset preserves orbit and pan.
 */
export function cameraResizeFactor(
  span: [number, number, number],
  direction: [number, number, number],
  up: [number, number, number],
  oldAspect: number,
  newAspect: number,
  verticalFovDegrees: number,
  plane: boolean,
): number {
  if (oldAspect === newAspect || !(oldAspect > 0 && newAspect > 0)) return 1;
  const fit = (aspect: number) =>
    plane
      ? planeFitDistance(span[0], span[1], aspect, verticalFovDegrees)
      : boxFitDistance(span, direction, up, aspect, verticalFovDegrees);
  return fit(newAspect) / fit(oldAspect);
}

/** Button zoom changes camera distance only, with the same limits as pointer navigation. */
export function zoomedDistance(distance: number, factor: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, distance * factor));
}
