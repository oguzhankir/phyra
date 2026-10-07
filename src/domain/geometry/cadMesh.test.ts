import { describe, expect, it } from 'vitest';
import {
  cadMeshDisplay,
  decodeCadMesh,
  validateCadMeshReceipt,
  type CadMeshReceipt,
} from './cadMesh';

export function meshFixture() {
  const buffer = new ArrayBuffer(208);
  new Float64Array(buffer, 0, 12).set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  new Uint32Array(buffer, 96, 4).set([0, 1, 2, 3]);
  new Uint32Array(buffer, 112, 12).set([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  new Uint32Array(buffer, 160, 4).set([0, 1, 2, 3]);
  new Float64Array(buffer, 192, 1).set([0.8]);
  const receipt: CadMeshReceipt = {
    protocolVersion: 1,
    operation: 'mesh-cad',
    purpose: 'inspection-only',
    status: 'succeeded',
    projectId: 'part',
    revision: 3,
    jobId: 'inspection-job',
    geometryFingerprint: 'a'.repeat(64),
    outputFeatureId: 'solid',
    coordinateFrame: 'cartesian-global-SI',
    targetSize: 0.4,
    meshId: 'b'.repeat(64),
    mesher: { name: 'Gmsh', version: 'test', element: 'tetra4' },
    byteLength: buffer.byteLength,
    bufferHash: 'c'.repeat(64),
    arrays: {
      positions: {
        offset: 0,
        byteLength: 96,
        dtype: 'float64',
        shape: [4, 3],
        association: 'node',
        units: 'm',
      },
      cells: {
        offset: 96,
        byteLength: 16,
        dtype: 'uint32',
        shape: [1, 4],
        association: 'cell',
        units: '1',
      },
      surface: {
        offset: 112,
        byteLength: 48,
        dtype: 'uint32',
        shape: [4, 3],
        association: 'triangle',
        units: '1',
      },
      surfaceRegions: {
        offset: 160,
        byteLength: 16,
        dtype: 'uint32',
        shape: [4],
        association: 'triangle',
        units: '1',
      },
      surfaceCells: {
        offset: 176,
        byteLength: 16,
        dtype: 'uint32',
        shape: [4],
        association: 'triangle',
        units: '1',
      },
      quality: {
        offset: 192,
        byteLength: 8,
        dtype: 'float64',
        shape: [1],
        association: 'cell',
        units: '1',
      },
    },
    regions: [0, 1, 2, 3].map((i) => ({
      id: `mesh-face-${i + 1}`,
      name: `Surface ${i + 1}`,
      identity: 'mesh-scoped',
      triangleCount: 1,
      area: i === 3 ? Math.sqrt(3) / 2 : 0.5,
    })),
    statistics: {
      bounds: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      nodes: 4,
      cells: 1,
      surfaceTriangles: 4,
      boundaryRegions: 4,
      minQuality: 0.8,
      maxQuality: 0.8,
      meanQuality: 0.8,
      exactVolume: 1 / 6,
      meshVolume: 1 / 6,
      relativeVolumeError: 0,
      exactSurfaceArea: 1.5 + Math.sqrt(3) / 2,
      meshSurfaceArea: 1.5 + Math.sqrt(3) / 2,
    },
  };
  return { receipt, buffer };
}

describe('transient exact-solid mesh inspection', () => {
  it('preserves SI data and draws unique boundary edges without assignable CAD identities', () => {
    const { receipt, buffer } = meshFixture();
    const mesh = decodeCadMesh(receipt, buffer);
    expect(mesh.positions.buffer).toBe(buffer);
    const display = cadMeshDisplay(mesh);
    expect(display.triangles).toBe(mesh.surface);
    expect(display.edgeSegments).toHaveLength(12);
    expect(display.faces.every((face) => face.identity === 'ambiguous')).toBe(true);
    expect(display.faces[0].id).toContain(receipt.jobId);
    expect(display.bodies).toHaveLength(0);
  });
  it('rejects wrong ownership, analysis purpose, size, limits and nonfinite measurements', () => {
    const { receipt } = meshFixture();
    expect(() => validateCadMeshReceipt(receipt, { id: 'other', revision: 3 }, 0.4)).toThrow(
      'identity',
    );
    expect(() => validateCadMeshReceipt(receipt, { id: 'part', revision: 4 }, 0.4)).toThrow(
      'identity',
    );
    expect(() => validateCadMeshReceipt(receipt, { id: 'part', revision: 3 }, 0.2)).toThrow(
      'identity',
    );
    for (const change of [
      (r: CadMeshReceipt) => {
        r.purpose = 'analysis' as 'inspection-only';
      },
      (r: CadMeshReceipt) => {
        r.statistics.cells = 50001;
      },
      (r: CadMeshReceipt) => {
        r.statistics.exactVolume = NaN;
      },
      (r: CadMeshReceipt) => {
        r.regions[0].identity = 'persistent' as 'mesh-scoped';
      },
      (r: CadMeshReceipt) => {
        r.regions[1].id = r.regions[0].id;
      },
      (r: CadMeshReceipt) => {
        r.targetSize = 1001;
      },
      (r: CadMeshReceipt) => {
        Object.assign(r, { analysisCompatibility: { state: 'supported' } });
      },
      (r: CadMeshReceipt) => {
        Object.assign(r, { assets: {} });
      },
    ]) {
      const bad = structuredClone(receipt);
      change(bad);
      expect(() => validateCadMeshReceipt(bad, { id: 'part', revision: 3 }, 0.4)).toThrow();
    }
  });
  it('rejects overlapping/misaligned arrays, bad indices, nonfinite quality and contradictory region counts', () => {
    const changes = [
      ({ receipt }: ReturnType<typeof meshFixture>) => {
        receipt.arrays.quality.offset = 184;
      },
      ({ receipt }: ReturnType<typeof meshFixture>) => {
        receipt.arrays.surface.offset = 113;
      },
      ({ buffer }: ReturnType<typeof meshFixture>) => {
        new Uint32Array(buffer, 96, 4)[3] = 4;
      },
      ({ buffer }: ReturnType<typeof meshFixture>) => {
        new Uint32Array(buffer, 112, 12)[1] = 0;
      },
      ({ buffer }: ReturnType<typeof meshFixture>) => {
        new Float64Array(buffer, 192, 1)[0] = NaN;
      },
      ({ receipt }: ReturnType<typeof meshFixture>) => {
        receipt.regions[0].triangleCount = 2;
      },
      ({ receipt }: ReturnType<typeof meshFixture>) => {
        receipt.arrays.positions.units = '1';
      },
      ({ receipt }: ReturnType<typeof meshFixture>) => {
        receipt.arrays.quality.association = 'node';
      },
    ];
    for (const change of changes) {
      const data = meshFixture();
      change(data);
      expect(() => decodeCadMesh(data.receipt, data.buffer)).toThrow();
    }
  });
});
