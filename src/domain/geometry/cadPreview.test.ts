import { describe, expect, it } from 'vitest';
import { cadPreview, type CadArrayDescriptor, type CadEntity } from './cadPreview';

function fixture() {
  const buffer = new ArrayBuffer(256);
  new Float64Array(buffer, 0, 9).set([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]);
  new Uint32Array(buffer, 72, 3).set([0, 1, 2]);
  new Uint32Array(buffer, 84, 1).set([0]);
  new Float64Array(buffer, 88, 6).set([0, 0, 0, 0.1, 0, 0]);
  new Uint32Array(buffer, 136, 2).set([0, 1]);
  new Uint32Array(buffer, 144, 1).set([0]);
  const arrays: Record<string, CadArrayDescriptor> = {
    positions: { offset: 0, byteLength: 72, dtype: 'float64', shape: [3, 3] },
    triangles: { offset: 72, byteLength: 12, dtype: 'uint32', shape: [1, 3] },
    triangleFaces: { offset: 84, byteLength: 4, dtype: 'uint32', shape: [1] },
    edgePositions: { offset: 88, byteLength: 48, dtype: 'float64', shape: [2, 3] },
    edgeSegments: { offset: 136, byteLength: 8, dtype: 'uint32', shape: [1, 2] },
    segmentEdges: { offset: 144, byteLength: 4, dtype: 'uint32', shape: [1] },
  };
  const entity = {
    id: 'signature-reference',
    name: 'Exact face',
    identity: 'content-reference' as const,
  };
  return {
    buffer,
    receipt: {
      byteLength: 256,
      arrays,
      faces: [entity],
      edges: [{ ...entity, id: 'edge-reference' }],
      bodies: [],
    },
  };
}
describe('CAD display buffers and durable entity association', () => {
  it('preserves Unicode labels and rejects unavailable bodies and mismatched component paths', () => {
    const { receipt, buffer } = fixture();
    const body: CadEntity = {
      id: 'body_ref',
      name: '🧩'.repeat(200),
      identity: 'content-reference',
      componentId: 'left',
      componentPath: ['left', 'nested'],
      sourceFeatureId: 'placed_box',
    };
    const attached = {
      ...receipt,
      bodies: [body],
      faces: [
        {
          ...receipt.faces[0],
          bodyId: body.id,
          componentId: 'left',
          componentPath: ['left', 'nested'],
        },
      ],
    };
    expect(cadPreview(attached, buffer).bodies[0].name).toBe(body.name);
    expect(() =>
      cadPreview({ ...attached, faces: [{ ...attached.faces[0], bodyId: 'missing' }] }, buffer),
    ).toThrow('unavailable body');
    expect(() =>
      cadPreview(
        { ...attached, faces: [{ ...attached.faces[0], componentPath: ['right'] }] },
        buffer,
      ),
    ).toThrow('component identity');
    expect(() =>
      cadPreview({ ...attached, bodies: [{ ...body, name: `${body.name}x` }] }, buffer),
    ).toThrow('metadata');
  });
  it('retains authoritative float64 SI coordinates and maps every displayed primitive to its exact reference', () => {
    const { receipt, buffer } = fixture();
    const preview = cadPreview(receipt, buffer);
    expect(preview.positions).toBeInstanceOf(Float64Array);
    expect(preview.positions[3]).toBe(0.1);
    expect(preview.positions.buffer).toBe(buffer);
    expect(preview.faces[preview.triangleFaces[0]].id).toBe('signature-reference');
    expect(preview.edges[preview.segmentEdges[0]].id).toBe('edge-reference');
  });
  it('rejects nonfinite coordinates, out of range vertex/entity indices and overlapping descriptors', () => {
    const first = fixture();
    new Float64Array(first.buffer)[0] = NaN;
    expect(() => cadPreview(first.receipt, first.buffer)).toThrow('coordinates');
    const second = fixture();
    new Uint32Array(second.buffer, 72, 3)[2] = 3;
    expect(() => cadPreview(second.receipt, second.buffer)).toThrow('coordinates');
    const third = fixture();
    new Uint32Array(third.buffer, 84, 1)[0] = 1;
    expect(() => cadPreview(third.receipt, third.buffer)).toThrow('associations');
    const fourth = fixture();
    fourth.receipt.arrays.triangles.offset = 4;
    expect(() => cadPreview(fourth.receipt, fourth.buffer)).toThrow('overlap');
  });
  it('enforces native cumulative bounds and refuses duplicate identities instead of index fallback', () => {
    const first = fixture();
    first.receipt.byteLength = 64 * 1024 * 1024 + 1;
    expect(() => cadPreview(first.receipt, first.buffer)).toThrow('size');
    const second = fixture();
    second.receipt.faces.push({ ...second.receipt.faces[0] });
    expect(() => cadPreview(second.receipt, second.buffer)).toThrow('metadata');
    const third = fixture();
    third.receipt.arrays.positions.shape[0] = 300001;
    expect(() => cadPreview(third.receipt, third.buffer)).toThrow('positions');
  });
});
