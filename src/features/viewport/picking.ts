import * as THREE from 'three';
import type { RegionId } from '../../domain/project/regions';
import type { SurfaceData } from './surface';

export function displayedNode(source: SurfaceData, node: number, scale: number): THREE.Vector3 {
  return new THREE.Vector3()
    .fromArray(source.positions, 3 * node)
    .addScaledVector(
      new THREE.Vector3().fromArray(
        source.displacement ?? new Float64Array(3),
        source.displacement ? 3 * node : 0,
      ),
      scale,
    );
}

/** Selection uses the current display shape; reported coordinates remain authoritative SI. */
export function nearestHitNode(
  source: SurfaceData,
  triangle: number,
  point: THREE.Vector3,
  scale: number,
): number {
  let nearest = source.triangles[3 * triangle];
  let distance = Infinity;
  for (let corner = 0; corner < 3; corner++) {
    const node = source.triangles[3 * triangle + corner];
    const candidate = displayedNode(source, node, scale).distanceToSquared(point);
    if (candidate < distance) {
      nearest = node;
      distance = candidate;
    }
  }
  return nearest;
}

export type ScreenPickContext = {
  camera: THREE.Camera;
  width: number;
  height: number;
};

function screenPoint(point: THREE.Vector3, screen: ScreenPickContext): THREE.Vector2 {
  const projected = point.clone().project(screen.camera);
  return new THREE.Vector2(
    ((projected.x + 1) * screen.width) / 2,
    ((1 - projected.y) * screen.height) / 2,
  );
}

/** Boundary selection is six CSS pixels wide at most, independent of DPI/zoom.
 * Overlapping boundary hit bands must not consume the interior of slender parts:
 * a selected boundary must be twice as close as every competing boundary region.
 * Distances include hidden regions, so isolation cannot select across them.
 */
export function pickedRegion(
  source: SurfaceData,
  triangle: number,
  point: THREE.Vector3,
  scale: number,
  screen: ScreenPickContext | null = null,
  visible: ReadonlySet<RegionId> | null = null,
): RegionId | 'Interior' {
  if (!source.boundaryEdges) {
    const region = source.regionIds[source.regions[triangle]];
    return !visible || visible.has(region) ? region : 'Interior';
  }
  if (!screen || !(screen.width > 0) || !(screen.height > 0)) return 'Interior';
  const point2d = screenPoint(point, screen);
  const distances = new Map<RegionId, number>();
  for (let edge = 0; edge < source.boundaryEdges.length / 2; edge++) {
    const region = source.regionIds[source.edgeRegions![edge]];
    const start = screenPoint(displayedNode(source, source.boundaryEdges[2 * edge], scale), screen);
    const end = screenPoint(
      displayedNode(source, source.boundaryEdges[2 * edge + 1], scale),
      screen,
    );
    const direction = end.clone().sub(start);
    const parameter =
      direction.lengthSq() > 0
        ? THREE.MathUtils.clamp(
            point2d.clone().sub(start).dot(direction) / direction.lengthSq(),
            0,
            1,
          )
        : 0;
    const distance = start.addScaledVector(direction, parameter).distanceTo(point2d);
    distances.set(region, Math.min(distances.get(region) ?? Infinity, distance));
  }
  let closest: RegionId | null = null;
  let distance = Infinity;
  for (const [region, candidate] of distances)
    if ((!visible || visible.has(region)) && candidate < distance) {
      closest = region;
      distance = candidate;
    }
  let competingDistance = Infinity;
  for (const [region, candidate] of distances)
    if (region !== closest) competingDistance = Math.min(competingDistance, candidate);
  return closest && distance <= 6 && distance * 2 < competingDistance ? closest : 'Interior';
}

/** Rendered triangle indices must map back to the original mesh after isolation. */
export function visibleTriangles(
  source: SurfaceData,
  visible: ReadonlySet<RegionId> | null,
): Uint32Array {
  const ids: number[] = [];
  for (let triangle = 0; triangle < source.triangles.length / 3; triangle++)
    if (source.boundaryEdges || !visible || visible.has(source.regionIds[source.regions[triangle]]))
      ids.push(triangle);
  return new Uint32Array(ids);
}
