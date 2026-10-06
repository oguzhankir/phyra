import { invoke } from '@tauri-apps/api/core';
import type { ProjectDefinition as Project } from '../../domain/contracts/types';
export type RecoveryRecord = { id: string; savedAt: number; projectName: string; revision: number };
export type RecoveryInventory = { records: RecoveryRecord[]; unreadableCount: number };
export type RecoveryReceipt = { accepted: boolean; savedAt: number; revision: number };

// One owner identifies this webview generation. Reloading it retires every old
// client, while individual document clients have isolated counters/journals.
export const recoveryOwnerId = crypto.randomUUID();
export function createRecoveryClient(documentId: string) {
  const identity = { ownerId: recoveryOwnerId, documentId, clientId: crypto.randomUUID() };
  let sequence = 0;
  let handshake: Promise<RecoveryInventory> | undefined;
  let released = false;
  const requireActive = () => {
    if (released) throw new Error('This recovery document has closed.');
  };
  const initialize = () => {
    requireActive();
    if (!handshake) {
      const attempt = invoke<RecoveryInventory>('get_recovery', identity);
      handshake = attempt;
      void attempt.catch(() => {
        // A transient storage/inventory failure must not poison this document's
        // checkpoint, cleanup and explicit retry operations for its lifetime.
        if (handshake === attempt) handshake = undefined;
      });
    }
    return handshake;
  };
  const nextSequence = () => ++sequence;
  return {
    nextSequence,
    initialize,
    getRecovery: async () => {
      if (!handshake) return initialize();
      await initialize();
      return invoke<RecoveryInventory>('get_recovery', identity);
    },
    writeRecovery: async (project: Project, ownSequence: number, restored = false) => {
      sequence = Math.max(sequence, ownSequence);
      await initialize();
      requireActive();
      return invoke<RecoveryReceipt>('write_recovery', {
        ...identity,
        project,
        sequence: ownSequence,
        restored,
      });
    },
    readRecovery: async (recoveryId: string) => {
      await initialize();
      requireActive();
      return invoke<{ project: Project; savedAt: number }>('read_recovery', {
        ...identity,
        recoveryId,
      });
    },
    clearRecovery: async (ownSequence: number, recoveryId: string | null = null) => {
      sequence = Math.max(sequence, ownSequence);
      await initialize();
      requireActive();
      return invoke<void>('clear_recovery', { ...identity, sequence: ownSequence, recoveryId });
    },
    prepareClose: async () => {
      await initialize();
      requireActive();
      return invoke<void>('preflight_close_project', identity);
    },
    release: async () => {
      if (released) return;
      await initialize();
      // Retirement releases the native file lease without deleting the journal.
      // Explicit save/discard/close cleanup calls clearRecovery beforehand.
      await invoke<void>('clear_recovery', {
        ...identity,
        sequence: nextSequence(),
        recoveryId: null,
        release: true,
      });
      released = true;
    },
  };
}

export type RecoveryClient = ReturnType<typeof createRecoveryClient>;

// Compatibility for verification and adapter callers that use one document.
const defaultClient = createRecoveryClient(crypto.randomUUID());
export const nextRecoverySequence = defaultClient.nextSequence;
export const getRecovery = defaultClient.getRecovery;
export const writeRecovery = defaultClient.writeRecovery;
export const readRecovery = defaultClient.readRecovery;
export const clearRecovery = defaultClient.clearRecovery;
