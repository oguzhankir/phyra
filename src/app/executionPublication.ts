import type { Manifest, ProjectDefinition } from '../domain/contracts/types';
import type { ResultData } from '../domain/results/fields';
import type { ExecutionLease, ExecutionOwnership } from './executionOwnership';

// Native fields remain a bounded candidate until the matching frontend owner
// receives their binary buffer. Failed handoffs retain the prior native result.
export async function receiveExecutionResult(
  ownership: ExecutionOwnership,
  lease: ExecutionLease,
  current: () => ProjectDefinition,
  manifest: Manifest,
  ports: {
    read: () => Promise<ArrayBuffer>;
    finish: (accept: boolean) => Promise<void>;
    cleanupFailed: (cause: unknown) => void;
  },
): Promise<ResultData | null> {
  let accepted = false;
  try {
    if (!ownership.bind(lease, manifest.jobId)) return null;
    const buffer = await ports.read();
    if (buffer.byteLength !== manifest.byteLength)
      throw new Error('The received result buffer does not match its validated manifest.');
    await ownership.settleCancellation(lease);
    if (!ownership.canPublish(lease, current(), manifest)) return null;
    await ports.finish(true);
    accepted = true;
    return ownership.canPublish(lease, current(), manifest) ? { manifest, buffer } : null;
  } finally {
    if (!accepted) await ports.finish(false).catch(ports.cleanupFailed);
  }
}
