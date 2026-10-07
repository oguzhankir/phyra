import { describe, expect, it } from 'vitest';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import { cadBodyAtTriangle, cadVisiblePrimitives } from './cadVisibility';
const preview: CadPreview = {
  positions: new Float64Array([0, 0, 0]),
  triangles: new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]),
  triangleFaces: new Uint32Array([0, 1, 2]),
  edgePositions: new Float64Array(),
  edgeSegments: new Uint32Array([0, 0, 0, 0]),
  segmentEdges: new Uint32Array([0, 1]),
  faces: [
    { id: 'left-face', name: 'Left', identity: 'content-reference', bodyId: 'left' },
    { id: 'right-face', name: 'Right', identity: 'content-reference', bodyId: 'right' },
    { id: 'surface', name: 'Shell', identity: 'content-reference' },
  ],
  edges: [
    { id: 'left-edge', name: 'Left', identity: 'content-reference', bodyId: 'left' },
    { id: 'shell-edge', name: 'Shell', identity: 'content-reference' },
  ],
  bodies: [
    { id: 'left', name: 'Left', identity: 'content-reference' },
    { id: 'right', name: 'Right', identity: 'content-reference' },
  ],
};
describe('instance-aware CAD visibility and picking', () => {
  it('hides only owned solid primitives while retaining surface shells and original buffers', () => {
    const positions = preview.positions.slice(),
      triangles = preview.triangles.slice();
    expect(cadVisiblePrimitives(preview, ['left'])).toEqual({ triangles: [1, 2], segments: [1] });
    expect(cadVisiblePrimitives(preview, [])).toEqual({ triangles: [0, 1, 2], segments: [0, 1] });
    expect(preview.positions).toEqual(positions);
    expect(preview.triangles).toEqual(triangles);
  });
  it('picks the exact instance from the original visible triangle mapping without nearest-body fallback', () => {
    const visible = cadVisiblePrimitives(preview, ['left']);
    expect(cadBodyAtTriangle(preview, visible.triangles[0])?.id).toBe('right');
    expect(cadBodyAtTriangle(preview, visible.triangles[1])).toBeNull();
    const single = { ...preview, bodies: [preview.bodies[0]] };
    expect(cadBodyAtTriangle(single, 2)).toBeNull();
  });
});
