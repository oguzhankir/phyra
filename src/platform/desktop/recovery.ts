import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../../domain/contracts/types';
export type RecoveryRecord = { id: string; savedAt: number; projectName: string; revision: number };
export type RecoveryInventory = { records: RecoveryRecord[]; unreadableCount: number };
export const getRecovery = () => invoke<RecoveryInventory>('get_recovery');
export const writeRecovery = (project: Project, sequence: number, restored = false) =>
  invoke<{ accepted: boolean; savedAt: number; revision: number }>('write_recovery', {
    project,
    sequence,
    restored,
  });
export const readRecovery = (recoveryId: string) =>
  invoke<{ project: Project; savedAt: number }>('read_recovery', { recoveryId });
export const clearRecovery = (sequence: number, recoveryId: string | null = null) =>
  invoke<void>('clear_recovery', { sequence, recoveryId });
