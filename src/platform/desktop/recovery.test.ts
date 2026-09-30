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
});
