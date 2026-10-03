import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Manifest } from '../../domain/contracts/types';
import { makeProject } from '../../features/examples/projects';
import {
  closeProject,
  exportResults,
  openProject,
  readBuffer,
  runJob,
  saveProject,
} from './bridge';
import { recoveryOwnerId } from './recovery';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('document-owned native archive and result commands', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('binds run, result read, save and export to the same project document and page owner', async () => {
    const documentId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const project = makeProject('cantilever');
    const manifest = { jobId: 'native-job', operation: 'solve' } as Manifest;
    vi.mocked(invoke)
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce([1, 2, 3])
      .mockResolvedValueOnce('/a.phyra')
      .mockResolvedValueOnce('/fields.csv')
      .mockResolvedValueOnce(undefined);
    expect(await runJob('solve', project, requestId, documentId)).toBe(manifest);
    expect(Array.from(new Uint8Array(await readBuffer(manifest.jobId, documentId)))).toEqual([
      1, 2, 3,
    ]);
    await saveProject(project, manifest.jobId, false, true, documentId);
    await exportResults(manifest.jobId, documentId);
    await closeProject(documentId);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      'run_job',
      'read_buffer',
      'save_project',
      'export_results',
      'close_project',
    ]);
    for (const [, args] of vi.mocked(invoke).mock.calls)
      expect(args).toMatchObject({ documentId, ownerId: recoveryOwnerId });
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      requestId,
      operation: 'solve',
      project,
    });
    expect(vi.mocked(invoke).mock.calls[2][1]).toMatchObject({
      automatic: true,
      saveAs: false,
      jobId: manifest.jobId,
    });
  });

  it('focuses an already-owned archive without loading or claiming a second binary cache', async () => {
    const requested = crypto.randomUUID();
    const existing = { existingDocumentId: crypto.randomUUID(), path: '/existing.phyra' };
    vi.mocked(invoke).mockResolvedValueOnce(existing);
    expect(await openProject(requested)).toBe(existing);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_project', {
      documentId: requested,
      ownerId: recoveryOwnerId,
    });
  });

  it('reads an imported cache from the document that acquired it, including reused job IDs', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const archive = {
      project: makeProject('cantilever'),
      path: '/a.phyra',
      manifest: { jobId: 'copied-id', operation: 'solve' } as Manifest,
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce(archive)
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce({ ...archive, path: '/b.phyra' })
      .mockResolvedValueOnce([2]);
    const first = await openProject(a);
    const second = await openProject(b);
    expect(first && 'buffer' in first && Array.from(new Uint8Array(first.buffer!))).toEqual([1]);
    expect(second && 'buffer' in second && Array.from(new Uint8Array(second.buffer!))).toEqual([2]);
    expect(vi.mocked(invoke).mock.calls[1]).toEqual([
      'read_buffer',
      { jobId: 'copied-id', documentId: a, ownerId: recoveryOwnerId },
    ]);
    expect(vi.mocked(invoke).mock.calls[3]).toEqual([
      'read_buffer',
      { jobId: 'copied-id', documentId: b, ownerId: recoveryOwnerId },
    ]);
  });
});
