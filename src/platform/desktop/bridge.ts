import { assertCapabilities, assertTrainingMetadata } from '../../domain/contracts/metadata';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  Project,
  Manifest,
  Progress,
  Operation,
  TrainingMetric,
  Devices,
} from '../../domain/contracts/types';

export async function runJob(operation: Operation, project: Project): Promise<Manifest> {
  const manifest = await invoke<Manifest>('run_job', { operation, project });
  assertTrainingMetadata(manifest);
  return manifest;
}
export async function getDevices(project: Project): Promise<Devices> {
  const result = await invoke<Devices>('get_devices', { project });
  if (result.capabilities) assertCapabilities(result.capabilities);
  return result;
}
export function subscribeMetrics(callback: (value: TrainingMetric) => void): Promise<() => void> {
  return listen<TrainingMetric>('engine-metrics', (event) => callback(event.payload));
}
export async function readBuffer(jobId: string): Promise<ArrayBuffer> {
  const value = await invoke<ArrayBuffer | number[]>('read_buffer', { jobId });
  return value instanceof ArrayBuffer ? value : new Uint8Array(value).buffer;
}
export function cancelJob(): Promise<void> {
  return invoke('cancel_job');
}
export async function openProject(): Promise<{
  project: Project;
  path: string;
  manifest?: Manifest;
  buffer?: ArrayBuffer;
  notice?: string;
} | null> {
  const opened = await invoke<{
    project: Project;
    path: string;
    manifest?: Manifest;
    notice?: string;
  } | null>('open_project');
  if (!opened) return null;
  if (opened.manifest) assertTrainingMetadata(opened.manifest);
  return {
    ...opened,
    buffer: opened.manifest ? await readBuffer(opened.manifest.jobId) : undefined,
  };
}
export function saveProject(
  project: Project,
  jobId?: string,
  saveAs = false,
): Promise<string | null> {
  return invoke('save_project', { project, jobId: jobId ?? null, saveAs });
}
export function exportResults(jobId: string): Promise<string | null> {
  return invoke('export_results', { jobId });
}
export function subscribeProgress(callback: (value: Progress) => void): Promise<() => void> {
  return listen<Progress>('engine-progress', (event) => callback(event.payload));
}
