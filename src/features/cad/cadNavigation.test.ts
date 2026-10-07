import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import { cadFrameHeight, cadNextPick, cadSelectionBounds, cadBoundsVisible } from './cadNavigation';

describe('CAD camera framing', () => {
  it('detects an edited shape outside the saved view without relying on its center', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(
      cadBoundsVisible(
        new THREE.Box3(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0)),
        camera,
      ),
    ).toBe(true);
    expect(
      cadBoundsVisible(
        new THREE.Box3(new THREE.Vector3(-10, -0.1, 0), new THREE.Vector3(10, 0.1, 0)),
        camera,
      ),
    ).toBe(false);
    expect(
      cadBoundsVisible(
        new THREE.Box3(new THREE.Vector3(10, 0, 0), new THREE.Vector3(11, 1, 0)),
        camera,
      ),
    ).toBe(false);
  });
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 1, 2));
  it('fits a slender part using both screen dimensions, in landscape and portrait', () => {
    const front = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 1, 0);
    expect(cadFrameHeight(box, front, up, 2)).toBeCloseTo(3);
    expect(cadFrameHeight(box, front, up, 0.5)).toBeCloseTo(12);
    expect(cadFrameHeight(box, new THREE.Vector3(1, 0, 0), up, 2)).toBeCloseTo(0.6);
  });
  it('contains every projected corner with margin in an oblique view', () => {
    const direction = new THREE.Vector3(1.3, -1.7, 1.2).normalize();
    const up = new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, direction).normalize();
    const vertical = new THREE.Vector3().crossVectors(direction, right);
    const center = box.getCenter(new THREE.Vector3());
    for (const aspect of [0.5, 1, 2]) {
      const height = cadFrameHeight(box, direction, up, aspect);
      for (const x of [0, 10])
        for (const y of [0, 1])
          for (const z of [0, 2]) {
            const point = new THREE.Vector3(x, y, z).sub(center);
            expect(Math.abs(point.dot(right))).toBeLessThan(height * aspect);
            expect(Math.abs(point.dot(vertical))).toBeLessThan(height);
          }
    }
  });
  it('uses only selected visible face, edge or body coordinates without changing their buffers', () => {
    const preview: CadPreview = {
      positions: new Float64Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 100, 100, 100]),
      triangles: new Uint32Array([0, 1, 2, 3, 3, 3]),
      triangleFaces: new Uint32Array([0, 1]),
      edgePositions: new Float64Array([0, 0, 0, 2, 0, 0]),
      edgeSegments: new Uint32Array([0, 1]),
      segmentEdges: new Uint32Array([0]),
      faces: [
        { id: 'face', name: 'Face', identity: 'content-reference', bodyId: 'body' },
        { id: 'far', name: 'Far', identity: 'content-reference', bodyId: 'hidden' },
      ],
      edges: [{ id: 'edge', name: 'Edge', identity: 'content-reference', bodyId: 'body' }],
      bodies: [
        { id: 'body', name: 'Body', identity: 'content-reference' },
        { id: 'hidden', name: 'Hidden', identity: 'content-reference' },
      ],
    };
    const copy = preview.positions.slice();
    expect(cadSelectionBounds(preview, ['hidden']).max.toArray()).toEqual([2, 2, 0]);
    expect(cadSelectionBounds(preview, [], ['edge']).max.toArray()).toEqual([2, 0, 0]);
    expect(cadSelectionBounds(preview, [], ['body']).max.toArray()).toEqual([2, 2, 0]);
    expect(cadSelectionBounds(preview, ['hidden'], ['far']).isEmpty()).toBe(true);
    expect(preview.positions).toEqual(copy);
  });
});

describe('CAD through-selection', () => {
  it('cycles unique entities, wraps, and lets an ordinary click restore the nearest hit', () => {
    const first = cadNextPick(null, ['front', 'front', 'back'], 10, 20, 'face', false);
    const back = cadNextPick(first, ['front', 'front', 'back'], 12, 20, 'face', true);
    expect(back.ids[back.index]).toBe('back');
    expect(cadNextPick(back, back.ids, 12, 20, 'face', true).index).toBe(0);
    expect(cadNextPick(back, back.ids, 12, 20, 'face', false).index).toBe(0);
  });
  it('resets after changing location, selection filter or visible topology', () => {
    const first = cadNextPick(null, ['front', 'back'], 10, 20, 'face', false);
    expect(cadNextPick(first, first.ids, 15, 20, 'face', true).index).toBe(0);
    expect(cadNextPick(first, first.ids, 10, 20, 'body', true).index).toBe(0);
    expect(cadNextPick(first, ['back'], 10, 20, 'face', true).index).toBe(0);
    expect(cadNextPick(first, [], 10, 20, 'face', true).ids).toEqual([]);
  });
});
