import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { makeProject } from '../../features/examples/projects';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

describe('recovery client ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('binds every recovery command to one immutable interface generation', async () => {
    const recovery = await import('./recovery');
    const project = makeProject('cantilever');
    await recovery.getRecovery();
    await recovery.readRecovery('previous');
    await recovery.writeRecovery(project, 1, true);
    await recovery.clearRecovery(2, 'previous');
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      'get_recovery',
      'read_recovery',
      'write_recovery',
      'clear_recovery',
    ]);
    const ids = calls.map(([, args]) => (args as { clientId: string }).clientId);
    expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(new Set(ids).size).toBe(1);
    expect(calls[2][1]).toMatchObject({ project, sequence: 1, restored: true });
  });

  it('rotates identity and counter together while late old commands retain both', async () => {
    const previous = await import('./recovery');
    await previous.getRecovery();
    expect(previous.nextRecoverySequence()).toBe(1);
    expect(previous.nextRecoverySequence()).toBe(2);
    vi.resetModules();
    const current = await import('./recovery');
    await current.getRecovery();
    await previous.clearRecovery(previous.nextRecoverySequence());
    await current.clearRecovery(current.nextRecoverySequence());
    const calls = vi.mocked(invoke).mock.calls;
    const ids = calls.map(([, args]) => (args as { clientId: string }).clientId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).toBe(ids[1]);
    expect(calls[2][1]).toMatchObject({ sequence: 3 });
    expect(calls[3][1]).toMatchObject({ sequence: 1 });
  });

  it('isolates tab identities and sequences within one webview owner', async () => {
    const { createRecoveryClient } = await import('./recovery');
    const a = createRecoveryClient(crypto.randomUUID());
    const b = createRecoveryClient(crypto.randomUUID());
    const project = makeProject('cantilever');
    await a.writeRecovery(project, a.nextSequence());
    await b.writeRecovery(project, b.nextSequence());
    await a.clearRecovery(a.nextSequence());
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      'get_recovery',
      'write_recovery',
      'get_recovery',
      'write_recovery',
      'clear_recovery',
    ]);
    const ai = calls[1][1] as { ownerId: string; documentId: string; clientId: string };
    const bi = calls[3][1] as typeof ai;
    expect(ai.ownerId).toBe(bi.ownerId);
    expect(ai.documentId).not.toBe(bi.documentId);
    expect(ai.clientId).not.toBe(bi.clientId);
    expect(calls[1][1]).toMatchObject({ sequence: 1 });
    expect(calls[3][1]).toMatchObject({ sequence: 1 });
    expect(calls[4][1]).toMatchObject({
      ownerId: ai.ownerId,
      documentId: ai.documentId,
      clientId: ai.clientId,
      sequence: 2,
    });
  });

  it('release retires the document without requesting journal deletion', async () => {
    const { createRecoveryClient } = await import('./recovery');
    const client = createRecoveryClient(crypto.randomUUID());
    const project = makeProject('cantilever');
    await client.writeRecovery(project, 10);
    await client.release();
    await client.release();
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      'get_recovery',
      'write_recovery',
      'clear_recovery',
    ]);
    expect(calls[2][1]).toMatchObject({ sequence: 11, recoveryId: null, release: true });
    await expect(client.writeRecovery(project, 12)).rejects.toThrow('closed');
    await expect(client.clearRecovery(13)).rejects.toThrow('closed');
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(3);
  });
});
