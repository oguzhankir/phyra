import { invoke } from '@tauri-apps/api/core';
import type { ProjectDefinition } from '../../domain/contracts/types';
import {
  decodeCadMesh,
  validateCadMeshReceipt,
  type CadMeshReceipt,
} from '../../domain/geometry/cadMesh';
import { finishCad } from './cad';
import { recoveryOwnerId } from './recovery';

export async function inspectCadMesh(
  project: ProjectDefinition,
  targetSize: number,
  requestId: string,
  documentId: string,
): Promise<CadMeshReceipt> {
  const receipt = await invoke<CadMeshReceipt>('mesh_cad', {
    project,
    targetSize,
    requestId,
    documentId,
    ownerId: recoveryOwnerId,
  });
  try {
    validateCadMeshReceipt(receipt, project, targetSize);
    if (
      project.geometry.kind !== 'cad' ||
      receipt.outputFeatureId !== project.geometry.outputFeatureId
    )
      throw new Error('Mesh inspection output does not match the current CAD definition.');
    return receipt;
  } catch (error) {
    if (typeof receipt?.jobId === 'string') await finishCad(receipt.jobId, documentId, false);
    throw error;
  }
}

export async function decodeCadMeshBuffer(receipt: CadMeshReceipt, buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== receipt.bufferHash)
    throw new Error('Mesh inspection buffer integrity check failed.');
  return decodeCadMesh(receipt, buffer);
}
