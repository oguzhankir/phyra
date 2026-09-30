import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cameraOrientation, planeFitDistance, solidFitDistance, boxFitDistance } from './camera';
describe('plane domain camera framing', () => {
  it('fits the physical height with margin in a wide scientific viewport', () => {
    const distance = planeFitDistance(0.1, 0.05, 3, 40);
    const viewHeight = 2 * distance * Math.tan((20 * Math.PI) / 180);
    expect(viewHeight).toBeCloseTo(0.05 * 1.25);
    expect(viewHeight * 3).toBeGreaterThan(0.1);
  });
  it('fits the width when the property panels leave a narrow viewport', () => {
    const distance = planeFitDistance(0.1, 0.05, 0.5, 40);
    const viewWidth = 2 * distance * Math.tan((20 * Math.PI) / 180) * 0.5;
    expect(viewWidth).toBeCloseTo(0.1 * 1.25);
    expect(viewWidth / 0.5).toBeGreaterThan(0.05);
  });
});

describe('solid camera framing', () => {
  it('frames every box corner with margin for axis and isometric views at narrow and wide aspects', () => {
    for (const span of [
      [0.2, 0.04, 0.02],
      [0.02, 0.4, 0.2],
      [0.2, 0.2, 0.2],
    ] as [number, number, number][])
      for (const aspect of [0.4, 1, 2.75])
        for (const view of [
          'front',
          'back',
          'left',
          'right',
          'top',
          'bottom',
          'isometric',
        ] as const) {
          const { direction, up } = cameraOrientation(view);
          const distance = boxFitDistance(span, direction, up, aspect, 38);
          const camera = new THREE.PerspectiveCamera(
            38,
            aspect,
            Math.hypot(...span) / 10000,
            Math.max(distance * 10, 1),
          );
          camera.position.copy(
            new THREE.Vector3(...direction).normalize().multiplyScalar(distance),
          );
          camera.up.set(...up);
          camera.lookAt(0, 0, 0);
          camera.updateMatrixWorld(true);
          for (const x of [-span[0] / 2, span[0] / 2])
            for (const y of [-span[1] / 2, span[1] / 2])
              for (const z of [-span[2] / 2, span[2] / 2]) {
                const projected = new THREE.Vector3(x, y, z).project(camera);
                expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.8 + 1e-12);
                expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.8 + 1e-12);
                expect(projected.z).toBeGreaterThan(-1);
                expect(projected.z).toBeLessThan(1);
              }
        }
  });
  it('uses useful horizontal space when framing a slender beam from above', () => {
    const distance = boxFitDistance([0.2, 0.04, 0.02], [0, 0, 1], [0, 1, 0], 2.75, 38);
    const camera = new THREE.PerspectiveCamera(38, 2.75, 1e-6, 10);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const left = new THREE.Vector3(-0.1, 0, 0.01).project(camera);
    const right = new THREE.Vector3(0.1, 0, 0.01).project(camera);
    expect(right.x - left.x).toBeCloseTo(1.6, 12);
  });
  it('fits a sphere in the limiting horizontal frustum rather than cropping narrow viewports', () => {
    for (const aspect of [0.4, 1, 2.5]) {
      const radius = Math.sqrt(1 + 4 + 9) / 2;
      const distance = solidFitDistance(radius, aspect, 38);
      const vertical = (19 * Math.PI) / 180;
      const horizontal = Math.atan(Math.tan(vertical) * aspect);
      expect(distance * Math.sin(vertical)).toBeGreaterThanOrEqual(radius * 1.25 - 1e-14);
      expect(distance * Math.sin(horizontal)).toBeGreaterThanOrEqual(radius * 1.25 - 1e-14);
    }
  });
  it('uses named physical axes and non-degenerate up vectors on opposing views', () => {
    expect(cameraOrientation('front').direction).toEqual([0, -1, 0]);
    expect(cameraOrientation('right').direction).toEqual([1, 0, 0]);
    for (const view of ['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric'] as const) {
      const { direction, up } = cameraOrientation(view);
      const cross = [
        direction[1] * up[2] - direction[2] * up[1],
        direction[2] * up[0] - direction[0] * up[2],
        direction[0] * up[1] - direction[1] * up[0],
      ];
      expect(Math.hypot(...cross)).toBeGreaterThan(0);
    }
    expect(cameraOrientation('top').up).toEqual([0, 1, 0]);
    expect(cameraOrientation('bottom').up).toEqual([0, -1, 0]);
  });
});
