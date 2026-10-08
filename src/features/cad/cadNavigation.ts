import * as THREE from 'three';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import { cadLegacyBodyId, cadVisiblePrimitives } from './cadVisibility';

/** Fit projected extents, rather than the 3D diagonal, so thin parts use the available canvas. */
export function cadFrameHeight(
  bounds: THREE.Box3,
  direction: THREE.Vector3,
  up: THREE.Vector3,
  aspect: number,
) {
  const forward = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const vertical = new THREE.Vector3().crossVectors(forward, right).normalize();
  const size = bounds.getSize(new THREE.Vector3());
  const projected = (axis: THREE.Vector3) =>
    Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
  return Math.max(projected(vertical), projected(right) / Math.max(aspect, 0.01), 1e-6) * 0.6;
}

/** Bounding boxes use visible display primitives only; they never change scientific coordinates. */
export function cadSelectionBounds(
  preview: CadPreview,
  hiddenBodies: readonly string[],
  selected: readonly string[] = [],
) {
  const selection = new Set(selected);
  const legacyBody = cadLegacyBodyId(preview);
  const visible = cadVisiblePrimitives(preview, hiddenBodies);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const add = (positions: Float64Array, index: number) =>
    box.expandByPoint(point.fromArray(positions, index * 3));
  const matches = (id: string, bodyId?: string) =>
    !selection.size || selection.has(id) || selection.has(bodyId ?? legacyBody ?? '');
  for (const triangle of visible.triangles) {
    const face = preview.faces[preview.triangleFaces[triangle]];
    if (!matches(face.id, face.bodyId)) continue;
    for (let corner = 0; corner < 3; corner++)
      add(preview.positions, preview.triangles[triangle * 3 + corner]);
  }
  for (const segment of visible.segments) {
    const edge = preview.edges[preview.segmentEdges[segment]];
    if (!matches(edge.id, edge.bodyId)) continue;
    for (let endpoint = 0; endpoint < 2; endpoint++)
      add(preview.edgePositions, preview.edgeSegments[segment * 2 + endpoint]);
  }
  return box;
}

export type CadPickCycle = {
  x: number;
  y: number;
  kind: string;
  ids: string[];
  index: number;
};

/** Repeated through-picks cycle distinct entities, never individual tessellation triangles. */
export function cadNextPick(
  previous: CadPickCycle | null,
  hits: readonly string[],
  x: number,
  y: number,
  kind: string,
  through: boolean,
): CadPickCycle {
  const ids = [...new Set(hits)];
  const same =
    previous &&
    previous.kind === kind &&
    Math.hypot(previous.x - x, previous.y - y) <= 4 &&
    ids.length === previous.ids.length &&
    ids.every((id, index) => id === previous.ids[index]);
  return {
    x,
    y,
    kind,
    ids,
    index: through && same && ids.length ? (previous.index + 1) % ids.length : 0,
  };
}

/** Test all box corners because the center alone misses long or offset shapes. */
export function cadBoundsVisible(bounds: THREE.Box3, camera: THREE.Camera) {
  const point = new THREE.Vector3();
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z).project(camera);
        if (
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          Math.abs(point.x) > 0.96 ||
          Math.abs(point.y) > 0.96 ||
          Math.abs(point.z) > 1
        )
          return false;
      }
  return !bounds.isEmpty();
}
