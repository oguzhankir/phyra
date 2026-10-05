import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../domain/contracts/types';
import { makeProject } from '../features/examples/projects';
import { ExecutionOwnership } from './executionOwnership';
import { receiveExecutionResult } from './executionPublication';

function fixture() {
  const project = makeProject('cantilever');
  // Opaque handoff bytes test publication ownership, not numerical accuracy.
  const manifest = {
    projectId: project.id,
    studyId: project.study.id,
    revision: project.revision,
    jobId: 'pending-native-fixture',
    operation: 'solve',
    byteLength: 8,
  } as Manifest;
  const ownership = new ExecutionOwnership();
  const lease = ownership.begin(structuredClone(project), 'solve');
  const ports = {
    read: vi.fn(async () => new ArrayBuffer(8)),
    finish: vi.fn(async (_accept: boolean) => {}),
    cleanupFailed: vi.fn(),
  };
  const receive = () => receiveExecutionResult(ownership, lease, () => project, manifest, ports);
  return { project, manifest, ownership, lease, ports, receive };
}

describe('document-owned result handoff', () => {
  it('acknowledges native publication only after receiving the matching binary buffer', async () => {
    const { manifest, ports, receive } = fixture();
    let resolve!: (buffer: ArrayBuffer) => void;
    ports.read.mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    const pending = receive();
    expect(ports.finish).not.toHaveBeenCalled();
    const buffer = new ArrayBuffer(8);
    resolve(buffer);
    expect(await pending).toEqual({ manifest, buffer });
    expect(ports.finish).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('discards a failed or truncated read while keeping the prior native result', async () => {
    for (const truncated of [false, true]) {
      const { ports, receive } = fixture();
      if (truncated) ports.read.mockResolvedValueOnce(new ArrayBuffer(4));
      else ports.read.mockRejectedValueOnce(new Error('buffer read failed'));
      await expect(receive()).rejects.toThrow(
        truncated ? 'validated manifest' : 'buffer read failed',
      );
      expect(ports.finish).toHaveBeenCalledExactlyOnceWith(false);
    }
  });

  it.each(['edited', 'cancelled', 'superseded'] as const)(
    'discards a delayed buffer when its execution was %s',
    async (change) => {
      const { project, ownership, lease, ports, receive } = fixture();
      ports.read.mockImplementationOnce(async () => {
        if (change === 'edited') project.revision += 1;
        else if (change === 'cancelled') ownership.cancel();
        else {
          ownership.finish(lease);
          ownership.begin(structuredClone(project), 'solve');
        }
        return new ArrayBuffer(8);
      });
      expect(await receive()).toBeNull();
      expect(ports.finish).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it('does not publish when native acceptance fails and preserves the original error if cleanup also fails', async () => {
    const { ports, receive } = fixture();
    ports.finish
      .mockRejectedValueOnce(new Error('acceptance failed'))
      .mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(receive()).rejects.toThrow('acceptance failed');
    expect(ports.finish.mock.calls).toEqual([[true], [false]]);
    expect(ports.cleanupFailed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'cleanup failed' }),
    );
  });
});
