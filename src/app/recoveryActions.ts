import type { Project } from '../domain/contracts/types';
import { recoverySnapshot } from '../domain/project/recovery';
import { inputError } from '../domain/project/validation';
export type RecoveryReceipt = { accepted: boolean; savedAt: number; revision: number };
type Ports = {
  read: (id: string) => Promise<{ project: Project }>;
  checkpoint: (project: Project) => Promise<RecoveryReceipt>;
  adopt: (project: Project, receipt: RecoveryReceipt) => void;
  removePrior: (id: string) => Promise<void>;
  onCleanupFailure: (cause: unknown) => void;
};
/** Adoption is durable before UI publication; removing the previous copy is best-effort cleanup. */
export async function restoreRecoveryRecord(id: string, ports: Ports): Promise<void> {
  const { project } = await ports.read(id);
  const validation = inputError(project);
  if (validation) throw new Error(`Recovery definition is invalid: ${validation}`);
  const receipt = await ports.checkpoint(recoverySnapshot(project));
  if (!receipt.accepted || receipt.revision !== project.revision)
    throw new Error('Recovery checkpoint was superseded; the previous copy was preserved.');
  ports.adopt(project, receipt);
  try {
    await ports.removePrior(id);
  } catch (cause) {
    ports.onCleanupFailure(cause);
  }
}
