import type { Project } from '../domain/contracts/types';
import { inputError } from '../domain/project/validation';

export interface SaveSnapshot {
  project: Project;
  path: string | null;
  jobId?: string;
  saveAs: boolean;
  automatic: boolean;
}

interface SavePorts {
  write: (
    project: Project,
    jobId: string | undefined,
    saveAs: boolean,
    automatic: boolean,
  ) => Promise<string | null>;
  sameDocument: () => boolean;
  current: () => boolean;
  associate: (path: string) => void;
  markSaved: () => void;
  clearRecovery: () => Promise<void>;
  cleanupFailed: (cause: unknown) => void;
}

// A completed archive write owns only its captured definition. It cannot mark
// newer edits saved or clear a replacement document's recovery checkpoint.
export async function persistProjectSnapshot(
  snapshot: SaveSnapshot,
  ports: SavePorts,
): Promise<boolean> {
  const project = structuredClone(snapshot.project);
  const invalid = inputError(project);
  if (invalid) throw new Error(invalid);
  if (snapshot.automatic && !snapshot.path)
    throw new Error('Save this project once before enabling archive autosave.');
  const saved = await ports.write(
    project,
    snapshot.jobId,
    snapshot.saveAs || !snapshot.path,
    snapshot.automatic,
  );
  if (!saved || !ports.sameDocument()) return false;
  ports.associate(saved);
  if (!ports.current()) return false;
  ports.markSaved();
  try {
    await ports.clearRecovery();
  } catch (cause) {
    ports.cleanupFailed(cause);
  }
  return ports.sameDocument() && ports.current();
}

export async function closeProjectDocument(ports: {
  prepareClose?: () => Promise<void>;
  canReplace: () => Promise<boolean>;
  clearRecovery: () => Promise<void>;
  close: () => void;
}): Promise<boolean> {
  await ports.prepareClose?.();
  if (!(await ports.canReplace())) return false;
  // Cleanup must finish before the active definition and fields disappear.
  await ports.clearRecovery();
  ports.close();
  return true;
}

export function scheduleProjectAutosave(ports: {
  dirty: () => boolean;
  blocked: () => boolean;
  waiting: () => void;
  paused: () => void;
  save: () => void;
}): () => void {
  let disposed = false;
  let timeout: ReturnType<typeof setTimeout>;
  const attempt = () => {
    if (disposed || !ports.dirty()) return;
    if (ports.blocked()) {
      ports.paused();
      timeout = setTimeout(attempt, 500);
      return;
    }
    ports.save();
  };
  ports.waiting();
  timeout = setTimeout(attempt, 1500);
  return () => {
    disposed = true;
    clearTimeout(timeout);
  };
}
