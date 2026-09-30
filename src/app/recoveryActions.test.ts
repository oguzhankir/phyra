import { describe, expect, it } from 'vitest';
import { makeProject } from '../features/examples/projects';
import { restoreRecoveryRecord } from './recoveryActions';
describe('durable recovery adoption', () => {
  it('publishes only after accepted persistence, then preserves adoption if cleanup fails', async () => {
    const project = makeProject('cantilever');
    const calls: string[] = [];
    await restoreRecoveryRecord('previous', {
      read: async () => {
        calls.push('read');
        return { project };
      },
      checkpoint: async (snapshot) => {
        expect(snapshot).not.toBe(project);
        calls.push('durable');
        return { accepted: true, savedAt: 42, revision: project.revision };
      },
      adopt: (value) => {
        expect(value.id).toBe(project.id);
        calls.push('publish');
      },
      removePrior: async () => {
        calls.push('cleanup');
        throw new Error('filesystem temporarily unavailable');
      },
      onCleanupFailure: () => calls.push('warning'),
    });
    expect(calls).toEqual(['read', 'durable', 'publish', 'cleanup', 'warning']);
  });
  it('does not change active project or clear the previous copy after rejected persistence', async () => {
    const project = makeProject('cantilever');
    let published = false;
    let removed = false;
    await expect(
      restoreRecoveryRecord('previous', {
        read: async () => ({ project }),
        checkpoint: async () => ({ accepted: false, savedAt: 42, revision: project.revision }),
        adopt: () => {
          published = true;
        },
        removePrior: async () => {
          removed = true;
        },
        onCleanupFailure: () => {},
      }),
    ).rejects.toThrow('superseded');
    expect(published).toBe(false);
    expect(removed).toBe(false);
  });
  it('blocks invalid physical definitions before any persistence or adoption', async () => {
    const project = makeProject('cantilever');
    project.geometry.length = 0;
    let persisted = false;
    await expect(
      restoreRecoveryRecord('previous', {
        read: async () => ({ project }),
        checkpoint: async () => {
          persisted = true;
          return { accepted: true, savedAt: 42, revision: 0 };
        },
        adopt: () => {},
        removePrior: async () => {},
        onCleanupFailure: () => {},
      }),
    ).rejects.toThrow('invalid');
    expect(persisted).toBe(false);
  });
});
