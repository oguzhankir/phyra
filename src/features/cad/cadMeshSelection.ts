import type { CadMeshReceipt } from '../../domain/geometry/cadMesh';

export type CadMeshSelection =
  | { kind: 'face'; projectId: string; geometryFingerprint: string; faceId: string }
  | { kind: 'region'; jobId: string; regionId: string }
  | null;
type BoundarySource = Pick<
  CadMeshReceipt,
  'projectId' | 'jobId' | 'geometryFingerprint' | 'correspondence' | 'regions'
>;

/** Only exact, unchanged source identities can carry a presentation selection across remeshing. */
export function selectMeshBoundary(receipt: BoundarySource, index: number): CadMeshSelection {
  const region = receipt.regions[index];
  if (!region) return null;
  return receipt.correspondence.status === 'verified' && region.cadFaceId
    ? {
        kind: 'face',
        projectId: receipt.projectId,
        geometryFingerprint: receipt.geometryFingerprint,
        faceId: region.cadFaceId,
      }
    : { kind: 'region', jobId: receipt.jobId, regionId: region.id };
}

export function selectedMeshBoundary(receipt: BoundarySource, selected: CadMeshSelection): number {
  if (!selected) return -1;
  if (selected.kind === 'face')
    return selected.projectId === receipt.projectId &&
      selected.geometryFingerprint === receipt.geometryFingerprint &&
      receipt.correspondence.status === 'verified'
      ? receipt.regions.findIndex((region) => region.cadFaceId === selected.faceId)
      : -1;
  return selected.jobId === receipt.jobId
    ? receipt.regions.findIndex((region) => region.id === selected.regionId)
    : -1;
}
