import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  cameraOrientation,
  planeFitDistance,
  solidFitDistance,
  boxFitDistance,
  cameraResizeFactor,
  zoomedDistance,
} from './camera';
it('keeps button zoom inside the pointer navigation limits and reverses a normal step', () => {
  expect(zoomedDistance(0.2, 0.8, 0.01, 10)).toBeCloseTo(0.16);
  expect(zoomedDistance(0.16, 1.25, 0.01, 10)).toBeCloseTo(0.2);
  expect(zoomedDistance(0.01, 0.8, 0.01, 10)).toBe(0.01);
  expect(zoomedDistance(10, 1.25, 0.01, 10)).toBe(10);
});
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

describe('viewport resizing', () => {
  it('keeps a fitted plate visible when the Study checklist gives way to a taller viewport', () => {
    const span: [number, number, number] = [0.1, 0.05, 0];
    const oldAspect = 420 / 160;
    const newAspect = 420 / 500;
    const distance = planeFitDistance(span[0], span[1], oldAspect, 38);
    const camera = new THREE.PerspectiveCamera(38, newAspect, 1e-6, 10);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    // Retaining the old distance after changing only aspect reproduces the crop.
    expect(Math.abs(new THREE.Vector3(span[0] / 2, 0, 0).project(camera).x)).toBeGreaterThan(1);
    camera.position.multiplyScalar(
      cameraResizeFactor(span, [0, 0, 1], [0, 1, 0], oldAspect, newAspect, 38, true),
    );
    camera.updateMatrixWorld(true);
    for (const x of [-span[0] / 2, span[0] / 2])
      for (const y of [-span[1] / 2, span[1] / 2]) {
        const projected = new THREE.Vector3(x, y, 0).project(camera);
        expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.8 + 1e-12);
        expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.8 + 1e-12);
      }
  });

  it('preserves manual zoom and returns to the original distance across layout changes', () => {
    const span: [number, number, number] = [0.1, 0.05, 0];
    for (const zoomRatio of [0.6, 1, 2.5]) {
      const original = planeFitDistance(span[0], span[1], 3, 38) * zoomRatio;
      const resized = original * cameraResizeFactor(span, [0, 0, 1], [0, 1, 0], 3, 0.6, 38, true);
      expect(resized / planeFitDistance(span[0], span[1], 0.6, 38)).toBeCloseTo(zoomRatio, 12);
      const restored = resized * cameraResizeFactor(span, [0, 0, 1], [0, 1, 0], 0.6, 3, 38, true);
      expect(restored).toBeCloseTo(original, 12);
    }
    expect(cameraResizeFactor(span, [0, 0, 1], [0, 1, 0], 3, 3, 38, true)).toBe(1);
  });

  it('preserves the pan target and custom solid orbit while maintaining fitted zoom', () => {
    const span: [number, number, number] = [0.2, 0.04, 0.02];
    const target = new THREE.Vector3(0.07, -0.01, 0.02);
    const direction: [number, number, number] = [2, -3, 1];
    const up: [number, number, number] = [0, 0, 1];
    const offset = new THREE.Vector3(...direction)
      .normalize()
      .multiplyScalar(boxFitDistance(span, direction, up, 2.75, 38) * 1.7);
    const before = offset.clone().normalize();
    const camera = target
      .clone()
      .addScaledVector(offset, cameraResizeFactor(span, direction, up, 2.75, 0.5, 38, false));
    const resizedOffset = camera.clone().sub(target);
    expect(resizedOffset.clone().normalize().distanceTo(before)).toBeLessThan(1e-14);
    expect(resizedOffset.length() / boxFitDistance(span, direction, up, 0.5, 38)).toBeCloseTo(
      1.7,
      12,
    );
    expect(target.toArray()).toEqual([0.07, -0.01, 0.02]);
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
