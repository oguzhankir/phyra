import type { ProjectDefinition } from '../domain/contracts/types';
import type { CadMeshPreview, CadMeshReceipt } from '../domain/geometry/cadMesh';

interface Bridge {
  inspect: (
    project: ProjectDefinition,
    size: number,
    requestId: string,
    documentId: string,
  ) => Promise<CadMeshReceipt>;
  read: (jobId: string, documentId: string) => Promise<ArrayBuffer>;
  decode: (receipt: CadMeshReceipt, buffer: ArrayBuffer) => Promise<CadMeshPreview>;
  finish: (jobId: string, documentId: string, accept: boolean) => Promise<void>;
}

/** Mesh inspection cannot displace the exact CAD export or publish a scientific result. */
export async function previewCadMesh(
  project: ProjectDefinition,
  size: number,
  requestId: string,
  documentId: string,
  owns: () => boolean,
  bridge: Bridge,
): Promise<CadMeshPreview | null> {
  let receipt: CadMeshReceipt | null = null;
  try {
    receipt = await bridge.inspect(project, size, requestId, documentId);
    if (!owns()) return null;
    const buffer = await bridge.read(receipt.jobId, documentId);
    if (!owns()) return null;
    const preview = await bridge.decode(receipt, buffer);
    if (!owns()) return null;
    await bridge.finish(receipt.jobId, documentId, false);
    receipt = null;
    return owns() ? preview : null;
  } finally {
    if (receipt) await bridge.finish(receipt.jobId, documentId, false);
  }
}
