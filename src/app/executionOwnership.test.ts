import { describe, expect, it } from 'vitest';
import type { Manifest } from '../domain/contracts/types';
import { makeProject } from '../features/examples/projects';
import { ExecutionOwnership } from './executionOwnership';

function fixture() {
  const project = makeProject('plane-stress-tension');
  const manifest = {
    projectId: project.id,
    studyId: project.study.id,
    revision: project.revision,
    jobId: 'owned-worker',
    operation: 'solve',
  } as Manifest;
  const ownership = new ExecutionOwnership();
  const lease = ownership.begin(structuredClone(project), 'solve');
  return { ownership, lease, project, manifest };
}

describe('native execution ownership', () => {
  it('admits a result only after the owned request has acquired its native identity', () => {
    const { ownership, lease, project, manifest } = fixture();
    expect(ownership.canPublish(lease, project, manifest)).toBe(false);
    expect(ownership.bind(lease, manifest.jobId)).toBe(true);
    expect(ownership.canPublish(lease, project, manifest)).toBe(true);
  });

  it('prevents a second request from silently taking ownership of a running worker', () => {
    const { ownership, project } = fixture();
    expect(() => ownership.begin(project, 'train')).toThrow('already owns');
  });

  it('accepts progress and metrics only from the identity already claimed by the run', () => {
    const { ownership, lease } = fixture();
    expect(ownership.event(lease.requestId, 'owned-worker')).toBe(lease);
    expect(ownership.event(lease.requestId, 'different-worker')).toBeNull();
    expect(ownership.bind(lease, 'different-worker')).toBe(false);
    expect(lease.jobId).toBe('owned-worker');
  });

  it('rejects events and a successful late result once cancellation was requested', () => {
    const { ownership, lease, project, manifest } = fixture();
    ownership.bind(lease, manifest.jobId);
    expect(ownership.cancel()).toBe(lease);
    expect(ownership.event(lease.requestId, manifest.jobId)).toBeNull();
    expect(ownership.bind(lease, manifest.jobId)).toBe(false);
    expect(ownership.canPublish(lease, project, manifest)).toBe(false);
    expect(ownership.finish(lease)).toBe(true);
    expect(ownership.cancel()).toBeNull();
  });

  it.each(['project', 'study', 'revision'] as const)(
    'rejects fields after the current %s identity changes',
    (change) => {
      const { ownership, lease, project, manifest } = fixture();
      ownership.bind(lease, manifest.jobId);
      if (change === 'project') project.id = 'other-project';
      if (change === 'study') project.study.id = 'other-study';
      if (change === 'revision') project.revision++;
      expect(ownership.canPublish(lease, project, manifest)).toBe(false);
    },
  );

  it.each([
    ['projectId', 'other-project'],
    ['studyId', 'other-study'],
    ['revision', 999],
    ['jobId', 'other-worker'],
    ['operation', 'train'],
  ] as const)('rejects a manifest with mismatched %s', (key, value) => {
    const { ownership, lease, project, manifest } = fixture();
    ownership.bind(lease, manifest.jobId);
    expect(ownership.canPublish(lease, project, { ...manifest, [key]: value })).toBe(false);
  });

  it('does not let an old completion clear, bind or publish into a later execution', () => {
    const { ownership, lease, project, manifest } = fixture();
    ownership.bind(lease, manifest.jobId);
    ownership.finish(lease);
    const next = ownership.begin(structuredClone(project), 'solve');
    expect(next.generation).toBeGreaterThan(lease.generation);
    expect(ownership.finish(lease)).toBe(false);
    expect(ownership.bind(lease, manifest.jobId)).toBe(false);
    expect(ownership.canPublish(lease, project, manifest)).toBe(false);
    expect(ownership.owns(next)).toBe(true);
  });

  it('ignores an unknown delayed event from a prior request before binding the new job', () => {
    const { ownership, lease, project } = fixture();
    // The previous native invocation failed before the UI ever learned its job ID.
    ownership.finish(lease);
    const next = ownership.begin(structuredClone(project), 'solve');
    expect(next.requestId).not.toBe(lease.requestId);
    expect(ownership.event(lease.requestId, 'previous-unseen-worker')).toBeNull();
    expect(next.jobId).toBeUndefined();
    expect(ownership.event(next.requestId, 'next-worker')).toBe(next);
    expect(next.jobId).toBe('next-worker');
  });

  it('rechecks ownership after a delayed binary buffer arrives', async () => {
    const { ownership, lease, project, manifest } = fixture();
    ownership.bind(lease, manifest.jobId);
    let release!: () => void;
    const bufferReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publication = (async () => {
      await bufferReady;
      return ownership.canPublish(lease, project, manifest);
    })();
    ownership.cancel();
    release();
    expect(await publication).toBe(false);
  });

  it.each([true, false])(
    'settles a run rejection arriving before cancellation acknowledgment (%s)',
    async (stopped) => {
      const { ownership, lease } = fixture();
      let acknowledge!: (value: boolean) => void;
      const stop = new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      });
      const cancelling = ownership.requestCancellation(lease, () => stop);
      let finished = false;
      const rejectedRun = (async () => {
        // Native run rejection can precede the cancellation command response.
        await ownership.settleCancellation(lease);
        const status = lease.cancelled ? 'cancelled' : 'failed';
        ownership.finish(lease);
        finished = true;
        return status;
      })();
      await Promise.resolve();
      expect(finished).toBe(false);
      expect(ownership.owns(lease)).toBe(true);
      acknowledge(stopped);
      expect(await cancelling).toBe(stopped);
      expect(await rejectedRun).toBe(stopped ? 'cancelled' : 'failed');
    },
  );

  it('failed cancellation preserves publication eligibility and old requests cannot stop newer work', async () => {
    const { ownership, lease, project, manifest } = fixture();
    ownership.bind(lease, manifest.jobId);
    await expect(
      ownership.requestCancellation(lease, async () => {
        throw new Error('cancel failed');
      }),
    ).rejects.toThrow('cancel failed');
    await ownership.settleCancellation(lease);
    expect(ownership.canPublish(lease, project, manifest)).toBe(true);
    ownership.finish(lease);
    const next = ownership.begin(structuredClone(project), 'solve');
    let called = false;
    expect(
      await ownership.requestCancellation(lease, async () => {
        called = true;
        return true;
      }),
    ).toBe(false);
    expect(called).toBe(false);
    expect(next.cancelled).toBe(false);
  });

  it('retries a transient cancellation failure with the same owned request', async () => {
    const { ownership, lease } = fixture();
    await expect(
      ownership.requestCancellation(lease, async () => {
        throw new Error('temporary IPC failure');
      }),
    ).rejects.toThrow('temporary IPC failure');
    expect(lease.cancelled).toBe(false);
    let calls = 0;
    expect(
      await ownership.requestCancellation(lease, async () => {
        calls += 1;
        return true;
      }),
    ).toBe(true);
    expect(calls).toBe(1);
    await ownership.settleCancellation(lease);
    expect(lease.cancelled).toBe(true);
  });
});
