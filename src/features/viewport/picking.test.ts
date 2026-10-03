import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  nearestHitNode,
  pickedRegion,
  visibleTriangles,
  selectedBoundaryBounds,
  type ScreenPickContext,
} from './picking';
import { planeFitDistance } from './camera';
import type { SurfaceData } from './surface';

const plane: SurfaceData = {
  positions: new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
  regions: new Uint32Array([0, 0]),
  regionIds: ['x0', 'x1', 'y0', 'y1'],
  boundaryEdges: new Uint32Array([3, 0, 1, 2, 0, 1, 2, 3]),
  edgeRegions: new Uint32Array([0, 1, 2, 3]),
};

function screenFor(
  width = 1000,
  height = 1000,
  plateWidth = 1,
  plateHeight = 1,
  zoom = 1,
): ScreenPickContext {
  const camera = new THREE.PerspectiveCamera(38, width / height, 1e-6, 1000);
  camera.position.set(
    plateWidth / 2,
    plateHeight / 2,
    planeFitDistance(plateWidth, plateHeight, width / height, 38) / zoom,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(plateWidth / 2, plateHeight / 2, 0);
  camera.updateMatrixWorld(true);
  return { camera, width, height };
}
const screen = screenFor();

describe('selected boundary camera framing', () => {
  it('uses only the selected 2D boundary and includes undeformed and amplified positions without changing arrays', () => {
    const displacement = new Float64Array([0, 0, 0, 0.2, -0.1, 0, 0.4, 0.1, 0, 0, 0, 0]);
    const source = { ...plane, displacement };
    const positionsBefore = [...plane.positions];
    const displacementsBefore = [...displacement];
    const bounds = selectedBoundaryBounds(source, new Set(['x1']), 2)!;
    expect(bounds.min.toArray()).toEqual([1, -0.2, 0]);
    expect(bounds.max.toArray()).toEqual([1.8, 1.2, 0]);
    expect(selectedBoundaryBounds(source, new Set(['missing']), 2)).toBeNull();
    expect([...plane.positions]).toEqual(positionsBefore);
    expect([...displacement]).toEqual(displacementsBefore);
  });
  it('frames selected 3D faces through their semantic region mapping', () => {
    const source: SurfaceData = {
      positions: plane.positions,
      triangles: plane.triangles,
      regions: new Uint32Array([0, 1]),
      regionIds: ['front', 'back'],
    };
    const bounds = selectedBoundaryBounds(source, new Set(['front']), 0)!;
    expect(bounds.min.toArray()).toEqual([0, 0, 0]);
    expect(bounds.max.toArray()).toEqual([1, 1, 0]);
  });
});

describe('dimensional boundary picking and isolation', () => {
  it('picks actual 2D edges and keeps the interior distinct from a 3D face', () => {
    expect(pickedRegion(plane, 0, new THREE.Vector3(1, 0.5, 0), 0, screen)).toBe('x1');
    expect(pickedRegion(plane, 1, new THREE.Vector3(0, 0.5, 0), 0, screen)).toBe('x0');
    expect(pickedRegion(plane, 0, new THREE.Vector3(0.5, 0.5, 0), 0, screen)).toBe('Interior');
  });
  it('reserves the interior of a slender plate even when opposing edge hit bands overlap', () => {
    const thin: SurfaceData = {
      ...plane,
      positions: new Float64Array([0, 0, 0, 1, 0, 0, 1, 0.01, 0, 0, 0.01, 0]),
    };
    for (const [width, height] of [
      [160, 400],
      [400, 400],
      [1200, 400],
    ])
      for (const zoom of [0.5, 1, 5]) {
        const projected = screenFor(width, height, 1, 0.01, zoom);
        expect(pickedRegion(thin, 0, new THREE.Vector3(0.5, 0.005, 0), 0, projected)).toBe(
          'Interior',
        );
        expect(pickedRegion(thin, 0, new THREE.Vector3(1, 0.005, 0), 0, projected)).toBe('x1');
        const metresPerPixel =
          (2 *
            (projected.camera as THREE.PerspectiveCamera).position.z *
            Math.tan((19 * Math.PI) / 180)) /
          height;
        const nearBottom = Math.min(0.001, 3 * metresPerPixel);
        expect(pickedRegion(thin, 0, new THREE.Vector3(0.5, nearBottom, 0), 0, projected)).toBe(
          'y0',
        );
      }
  });
  it('uses the same CSS-pixel edge band across zoom and viewport aspect ratios', () => {
    for (const [width, height] of [
      [160, 400],
      [400, 400],
      [1200, 400],
    ])
      for (const zoom of [0.5, 1, 2]) {
        const projected = screenFor(width, height, 1, 1, zoom);
        const metresPerPixel =
          (2 *
            (projected.camera as THREE.PerspectiveCamera).position.z *
            Math.tan((19 * Math.PI) / 180)) /
          height;
        expect(
          pickedRegion(plane, 0, new THREE.Vector3(0.5, 3 * metresPerPixel, 0), 0, projected),
        ).toBe('y0');
        expect(
          pickedRegion(plane, 0, new THREE.Vector3(0.5, 7 * metresPerPixel, 0), 0, projected),
        ).toBe('Interior');
      }
  });
  it('requires a visible projection and declines ambiguous shared corners', () => {
    expect(pickedRegion(plane, 0, new THREE.Vector3(0.5, 0.5, 0), 0)).toBe('Interior');
    expect(pickedRegion(plane, 0, new THREE.Vector3(0, 0, 0), 0, screen)).toBe('Interior');
    expect(pickedRegion(plane, 0, new THREE.Vector3(0.5, 0.5, 0), 0, { ...screen, width: 0 })).toBe(
      'Interior',
    );
  });
  it('does not select a hidden 2D boundary even though contextual plate geometry remains', () => {
    const visible = new Set<'x0'>(['x0']);
    expect(pickedRegion(plane, 0, new THREE.Vector3(1, 0.5, 0), 0, screen, visible)).toBe(
      'Interior',
    );
    expect(pickedRegion(plane, 1, new THREE.Vector3(0, 0.5, 0), 0, screen, visible)).toBe('x0');
    expect(Array.from(visibleTriangles(plane, visible))).toEqual([0, 1]);
  });
  it('retains original triangle/cell identity when hidden 3D faces are removed', () => {
    const solid: SurfaceData = {
      ...plane,
      boundaryEdges: undefined,
      edgeRegions: undefined,
      regions: new Uint32Array([1, 0]),
      cells: new Uint32Array([12, 27]),
    };
    const mapping = visibleTriangles(solid, new Set(['x0'] as const));
    expect(Array.from(mapping)).toEqual([1]);
    expect(solid.cells![mapping[0]]).toBe(27);
    expect(
      pickedRegion(solid, mapping[0], new THREE.Vector3(), 0, screen, new Set(['x0'] as const)),
    ).toBe('x0');
    expect(pickedRegion(solid, 0, new THREE.Vector3(), 0, screen, new Set(['x0'] as const))).toBe(
      'Interior',
    );
  });
  it('uses actual displayed displacement for boundary picking and nearest-node snapping', () => {
    const moved: SurfaceData = {
      ...plane,
      displacement: new Float64Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]),
    };
    expect(
      pickedRegion(moved, 0, new THREE.Vector3(11, 0.5, 0), 10, screenFor(1000, 1000, 12, 1)),
    ).toBe('x1');
    expect(nearestHitNode(moved, 0, new THREE.Vector3(11, 0.05, 0), 10)).toBe(1);
    expect(Array.from(moved.positions)).toEqual(Array.from(plane.positions));
  });
});
