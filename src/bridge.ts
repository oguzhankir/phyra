import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Project, Manifest, Progress } from './types';

export function runJob(operation: 'mesh' | 'solve', project: Project): Promise<Manifest> {
  return invoke('run_job', { operation, project });
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
} | null> {
  const opened = await invoke<{ project: Project; path: string; manifest?: Manifest } | null>(
    'open_project',
  );
  if (!opened) return null;
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
