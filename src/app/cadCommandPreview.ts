import type { ProjectDefinition } from '../domain/contracts/types';
import type { CadCommandPreview } from '../features/cad/commandDraft';
import type { CadDisplay, CadReceipt } from '../platform/desktop/cad';

interface Bridge {
  evaluate: (
    project: ProjectDefinition,
    requestId: string,
    documentId: string,
  ) => Promise<CadReceipt>;
  read: (jobId: string, documentId: string) => Promise<ArrayBuffer>;
  decode: (receipt: CadReceipt, buffer: ArrayBuffer) => Promise<CadDisplay>;
  finish: (jobId: string, documentId: string, accept: boolean) => Promise<void>;
}

/** Discard the staged native job before publishing any transient preview. */
export async function previewCadCommand(
  project: ProjectDefinition,
  requestId: string,
  documentId: string,
  owns: () => boolean,
  bridge: Bridge,
): Promise<CadCommandPreview | null> {
  let receipt: CadReceipt | null = null;
  try {
    receipt = await bridge.evaluate(project, requestId, documentId);
    if (!owns()) return null;
    const buffer = await bridge.read(receipt.jobId, documentId);
    if (!owns()) return null;
    const display = await bridge.decode(receipt, buffer);
    if (!owns()) return null;
    const preview: CadCommandPreview = {
      preview: { ...display, faces: receipt.faces, edges: receipt.edges, bodies: receipt.bodies },
      kernel: `${receipt.kernel.name} ${receipt.kernel.version}`,
      faceCount: receipt.statistics.faceCount,
      edgeCount: receipt.statistics.edgeCount,
      bodyCount: receipt.statistics.bodyCount,
      volume: receipt.statistics.volume,
      surfaceArea: receipt.statistics.surfaceArea,
    };
    // Never accept a draft job: doing so would replace the last committed export.
    await bridge.finish(receipt.jobId, documentId, false);
    receipt = null;
    return owns() ? preview : null;
  } finally {
    if (receipt) await bridge.finish(receipt.jobId, documentId, false);
  }
}
