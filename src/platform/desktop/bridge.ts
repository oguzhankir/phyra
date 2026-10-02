import {
  assertCapabilities,
  assertTrainingMetadata,
  assertReferenceMetadata,
} from '../../domain/contracts/metadata';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { recoveryOwnerId } from './recovery';
import type {
  Project,
  Manifest,
  Progress,
  Operation,
  TrainingMetric,
  Devices,
} from '../../domain/contracts/types';

// Correlation belongs to the transient desktop event transport. Numerical
// manifests and training histories retain their native job identity unchanged.
export interface ExecutionEvent<T> {
  requestId: string;
  payload: T;
}

export async function runJob(
  operation: Operation,
  project: Project,
  requestId: string,
  documentId?: string,
): Promise<Manifest> {
  const manifest = await invoke<Manifest>('run_job', {
    operation,
    project,
    requestId,
    documentId: documentId ?? null,
    ownerId: recoveryOwnerId,
  });
  assertTrainingMetadata(manifest);
  assertReferenceMetadata(manifest);
  return manifest;
}
export async function getDevices(project: Project): Promise<Devices> {
  const result = await invoke<Devices>('get_devices', { project });
  if (result.capabilities) assertCapabilities(result.capabilities);
  return result;
}
export function subscribeMetrics(
  callback: (value: ExecutionEvent<TrainingMetric>) => void,
): Promise<() => void> {
  return listen<ExecutionEvent<TrainingMetric>>('engine-metrics', (event) =>
    callback(event.payload),
  );
}
export async function readBuffer(jobId: string, documentId?: string): Promise<ArrayBuffer> {
  const value = await invoke<ArrayBuffer | number[]>('read_buffer', {
    jobId,
    documentId: documentId ?? null,
    ownerId: recoveryOwnerId,
  });
  return value instanceof ArrayBuffer ? value : new Uint8Array(value).buffer;
}
export function cancelJob(): Promise<void> {
  return invoke('cancel_job');
}
export type OpenedProject = {
  project: Project;
  path: string;
  manifest?: Manifest;
  buffer?: ArrayBuffer;
  notice?: string;
};
export type ExistingProjectDocument = { existingDocumentId: string; path: string };
export async function openProject(
  documentId?: string,
): Promise<OpenedProject | ExistingProjectDocument | null> {
  const opened = await invoke<
    | {
        project: Project;
        path: string;
        manifest?: Manifest;
        notice?: string;
      }
    | ExistingProjectDocument
    | null
  >('open_project', {
    documentId: documentId ?? null,
    ownerId: recoveryOwnerId,
  });
  if (!opened) return null;
  if ('existingDocumentId' in opened) return opened;
  if (opened.manifest) {
    assertTrainingMetadata(opened.manifest);
    assertReferenceMetadata(opened.manifest);
  }
  return {
    ...opened,
    buffer: opened.manifest ? await readBuffer(opened.manifest.jobId, documentId) : undefined,
  };
}
export function saveProject(
  project: Project,
  jobId?: string,
  saveAs = false,
  automatic = false,
  documentId?: string,
): Promise<string | null> {
  return invoke('save_project', {
    project,
    jobId: jobId ?? null,
    saveAs,
    automatic,
    documentId: documentId ?? null,
    ownerId: recoveryOwnerId,
  });
}
export function closeProject(documentId: string): Promise<void> {
  return invoke('close_project', { documentId, ownerId: recoveryOwnerId });
}
export function exportResults(jobId: string, documentId?: string): Promise<string | null> {
  return invoke('export_results', {
    jobId,
    documentId: documentId ?? null,
    ownerId: recoveryOwnerId,
  });
}
export function subscribeProgress(
  callback: (value: ExecutionEvent<Progress>) => void,
): Promise<() => void> {
  return listen<ExecutionEvent<Progress>>('engine-progress', (event) => callback(event.payload));
}
