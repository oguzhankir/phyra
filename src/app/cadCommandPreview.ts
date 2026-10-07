import type { ProjectDefinition } from '../domain/contracts/types';
import type { CadCommandPreview } from '../features/cad/commandDraft';
import type { CadDisplay, CadReceipt } from '../platform/desktop/cad';

export type CadPreviewStage =
  | 'evaluate-start'
  | 'evaluate-received'
  | 'read-start'
  | 'read-received'
  | 'decode-start'
  | 'decode-complete'
  | 'discard-start'
  | 'discard-complete'
  | 'cleanup-start'
  | 'cleanup-complete';

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
  trace?: (stage: CadPreviewStage) => void,
): Promise<CadCommandPreview | null> {
  let receipt: CadReceipt | null = null;
  try {
    trace?.('evaluate-start');
    receipt = await bridge.evaluate(project, requestId, documentId);
    trace?.('evaluate-received');
    if (!owns()) return null;
    trace?.('read-start');
    const buffer = await bridge.read(receipt.jobId, documentId);
    trace?.('read-received');
    if (!owns()) return null;
    trace?.('decode-start');
    const display = await bridge.decode(receipt, buffer);
    trace?.('decode-complete');
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
    trace?.('discard-start');
    await bridge.finish(receipt.jobId, documentId, false);
    trace?.('discard-complete');
    receipt = null;
    return owns() ? preview : null;
  } finally {
    if (receipt) {
      trace?.('cleanup-start');
      await bridge.finish(receipt.jobId, documentId, false);
      trace?.('cleanup-complete');
    }
  }
}
