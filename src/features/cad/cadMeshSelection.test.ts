import { describe, expect, it } from 'vitest';
import type { CadMeshReceipt } from '../../domain/geometry/cadMesh';
import { selectMeshBoundary, selectedMeshBoundary } from './cadMeshSelection';

function meshFixture(): {
  receipt: Pick<
    CadMeshReceipt,
    'projectId' | 'jobId' | 'geometryFingerprint' | 'correspondence' | 'regions'
  >;
} {
  return {
    receipt: {
      projectId: 'first-document',
      jobId: 'first-job',
      geometryFingerprint: 'a'.repeat(64),
      correspondence: {
        status: 'unavailable',
        scope: 'unchanged-geometry',
        method: 'exact-brep-round-trip',
        reason: 'No CAD source',
      },
      regions: [1, 2, 3, 4].map((i) => ({
        id: `mesh-face-${i}`,
        name: `Surface ${i}`,
        identity: 'mesh-scoped',
        area: 1,
        triangleCount: 2,
      })),
    },
  };
}

describe('mesh inspection selection ownership', () => {
  it('keeps a matched face through remeshing with reordered regions, but drops changed geometry', () => {
    const { receipt } = meshFixture();
    receipt.correspondence = {
      status: 'verified',
      scope: 'unchanged-geometry',
      method: 'exact-brep-round-trip',
    };
    receipt.regions.forEach((r, i) => {
      r.cadFaceId = `solid/face/${String(i).repeat(24)}`;
    });
    const selected = selectMeshBoundary(receipt, 0);
    const remeshed = structuredClone(receipt);
    remeshed.jobId = 'remesh';
    remeshed.regions.reverse();
    expect(selectedMeshBoundary(remeshed, selected)).toBe(3);
    expect(selectedMeshBoundary({ ...remeshed, projectId: 'another-document' }, selected)).toBe(-1);
    remeshed.geometryFingerprint = 'e'.repeat(64);
    expect(selectedMeshBoundary(remeshed, selected)).toBe(-1);
  });
  it('never transfers a mesh-scoped row across jobs or upgrades it to a CAD face selection', () => {
    const { receipt } = meshFixture();
    const selected = selectMeshBoundary(receipt, 1);
    expect(selectedMeshBoundary(receipt, selected)).toBe(1);
    expect(selectedMeshBoundary({ ...receipt, jobId: 'another' }, selected)).toBe(-1);
    expect(selectMeshBoundary(receipt, -1)).toBeNull();
    expect(selectedMeshBoundary(receipt, null)).toBe(-1);
  });
});
