import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProject } from '../features/examples/projects';
import { CadCommandOwnership } from '../features/cad/commandDraft';
import {
  closeProjectDocument,
  persistProjectSnapshot,
  projectReplacementIssue,
  scheduleProjectAutosave,
  type SaveSnapshot,
} from './projectPersistence';

function snapshot(overrides: Partial<SaveSnapshot> = {}): SaveSnapshot {
  return {
    project: makeProject('plane-stress-tension'),
    path: '/owned/project.phyra',
    saveAs: false,
    automatic: false,
    ...overrides,
  };
}

function ports() {
  type ArchiveWrite = (
    project: SaveSnapshot['project'],
    jobId: string | undefined,
    saveAs: boolean,
    automatic: boolean,
  ) => Promise<string | null>;
  return {
    write: vi.fn<ArchiveWrite>(async () => '/owned/project.phyra'),
    sameDocument: () => true,
    current: () => true,
    associate: vi.fn(),
    markSaved: vi.fn(),
    clearRecovery: vi.fn(async () => {}),
    cleanupFailed: vi.fn(),
  };
}

describe('project archive publication', () => {
  it('forces the first manual save to choose a file even if native state has an old association', async () => {
    const current = snapshot({ path: null });
    const io = ports();
    expect(await persistProjectSnapshot(current, io)).toBe(true);
    expect(io.write).toHaveBeenCalledWith(current.project, undefined, true, false);
    expect(io.markSaved).toHaveBeenCalledOnce();
    expect(io.clearRecovery).toHaveBeenCalledOnce();
  });

  it('autosaves an associated validated definition with its owned current cache', async () => {
    const current = snapshot({ automatic: true, jobId: 'current-cache' });
    const io = ports();
    expect(await persistProjectSnapshot(current, io)).toBe(true);
    expect(io.write).toHaveBeenCalledWith(current.project, 'current-cache', false, true);
  });

  it('does not create a dialog write for an unsaved draft or invalid physical definition', async () => {
    const io = ports();
    await expect(
      persistProjectSnapshot(snapshot({ path: null, automatic: true }), io),
    ).rejects.toThrow('Save this project once');
    const invalid = snapshot();
    invalid.project.study!.material.young = 0;
    await expect(persistProjectSnapshot(invalid, io)).rejects.toThrow();
    expect(io.write).not.toHaveBeenCalled();
    expect(io.clearRecovery).not.toHaveBeenCalled();
  });

  it('preserves dirty state and the recovery copy when a file dialog is cancelled or writing fails', async () => {
    const io = ports();
    io.write.mockResolvedValueOnce(null);
    expect(await persistProjectSnapshot(snapshot(), io)).toBe(false);
    expect(io.associate).not.toHaveBeenCalled();
    expect(io.markSaved).not.toHaveBeenCalled();
    expect(io.clearRecovery).not.toHaveBeenCalled();
    io.write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(persistProjectSnapshot(snapshot(), io)).rejects.toThrow('disk unavailable');
    expect(io.clearRecovery).not.toHaveBeenCalled();
  });

  it('does not mark edits made during a write as saved or discard their recovery copy', async () => {
    const current = snapshot();
    const io = ports();
    let generation = 0;
    let finish!: (path: string) => void;
    io.current = () => generation === 0;
    io.write.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = persistProjectSnapshot(current, io);
    generation += 1;
    current.project.name = 'A newer edit';
    finish('/owned/project.phyra');
    expect(await saving).toBe(false);
    expect(io.write.mock.calls[0][0]).not.toBe(current.project);
    expect(io.write.mock.calls[0][0].name).not.toBe('A newer edit');
    expect(io.associate).toHaveBeenCalledWith('/owned/project.phyra');
    expect(io.markSaved).not.toHaveBeenCalled();
    expect(io.clearRecovery).not.toHaveBeenCalled();
  });

  it('does not publish a late write into a replacement document', async () => {
    const io = ports();
    let replaced = false;
    io.sameDocument = () => !replaced;
    let finish!: (path: string) => void;
    io.write.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = persistProjectSnapshot(snapshot(), io);
    replaced = true;
    finish('/owned/old.phyra');
    expect(await saving).toBe(false);
    expect(io.associate).not.toHaveBeenCalled();
    expect(io.markSaved).not.toHaveBeenCalled();
    expect(io.clearRecovery).not.toHaveBeenCalled();
  });

  it('keeps a durable save successful and reports an undeleted recovery copy', async () => {
    const io = ports();
    const failure = new Error('recovery journal is locked');
    io.clearRecovery = vi.fn(async () => {
      throw failure;
    });
    expect(await persistProjectSnapshot(snapshot(), io)).toBe(true);
    expect(io.markSaved).toHaveBeenCalledOnce();
    expect(io.cleanupFailed).toHaveBeenCalledWith(failure);
  });

  it('cannot authorize a close after a newer edit arrives during recovery cleanup', async () => {
    const io = ports();
    let current = true;
    io.current = () => current;
    io.clearRecovery = vi.fn(async () => {
      current = false;
    });
    expect(await persistProjectSnapshot(snapshot(), io)).toBe(false);
    expect(io.markSaved).toHaveBeenCalledOnce();
  });
});

describe('archive autosave scheduling', () => {
  afterEach(() => vi.useRealTimers());

  function autosavePorts() {
    return {
      dirty: () => true,
      blocked: () => false,
      waiting: vi.fn(),
      paused: vi.fn(),
      save: vi.fn(),
    };
  }

  it('waits for 1.5 seconds of idle time and writes once', () => {
    vi.useFakeTimers();
    const io = autosavePorts();
    scheduleProjectAutosave(io);
    vi.advanceTimersByTime(1499);
    expect(io.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(io.save).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(io.save).toHaveBeenCalledOnce();
  });

  it('postpones an idle write during compute, file, recovery or confirmation activity', () => {
    vi.useFakeTimers();
    const io = autosavePorts();
    let blocked = true;
    io.blocked = () => blocked;
    scheduleProjectAutosave(io);
    vi.advanceTimersByTime(1500);
    expect(io.paused).toHaveBeenCalledOnce();
    expect(io.save).not.toHaveBeenCalled();
    blocked = false;
    vi.advanceTimersByTime(500);
    expect(io.save).toHaveBeenCalledOnce();
  });

  it('cancels the previous edit timer and starts a fresh idle interval for the next edit', () => {
    vi.useFakeTimers();
    const io = autosavePorts();
    const cancelPrior = scheduleProjectAutosave(io);
    vi.advanceTimersByTime(1000);
    cancelPrior();
    scheduleProjectAutosave(io);
    vi.advanceTimersByTime(1499);
    expect(io.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(io.save).toHaveBeenCalledOnce();
  });

  it('never starts a queued write after the document closes or the archive is already saved', () => {
    vi.useFakeTimers();
    const io = autosavePorts();
    io.blocked = () => true;
    const cancel = scheduleProjectAutosave(io);
    vi.advanceTimersByTime(1500);
    cancel();
    io.blocked = () => false;
    vi.advanceTimersByTime(5000);
    expect(io.save).not.toHaveBeenCalled();
    io.dirty = () => false;
    scheduleProjectAutosave(io);
    vi.advanceTimersByTime(2000);
    expect(io.save).not.toHaveBeenCalled();
  });
});

describe('closing a project document', () => {
  it.each([false, true])(
    'preserves an active CAD command before any close confirmation or cleanup (dirty: %s)',
    async (dirty) => {
      const project = snapshot().project;
      const original = structuredClone(project);
      const command = new CadCommandOwnership();
      command.begin(
        project,
        {
          kind: 'cad',
          dimension: '3d',
          features: [
            { id: 'box', kind: 'box', name: 'Box', length: 0.1, width: 0.05, height: 0.025 },
          ],
          outputFeatureId: 'box',
          assets: [],
        },
        'box',
        'Box',
      );
      const draft = command.current()!;
      const drafts = new Map([[draft.markerId, draft.label]]);
      const confirmDirty = vi.fn(async () => true);
      const clearRecovery = vi.fn(async () => {});
      const close = vi.fn();
      const reportIssue = vi.fn();
      const canReplace = async () => {
        const issue = projectReplacementIssue(drafts);
        if (issue) {
          reportIssue(issue);
          return false;
        }
        return dirty ? confirmDirty() : true;
      };
      expect(await closeProjectDocument({ canReplace, clearRecovery, close })).toBe(false);
      expect(reportIssue).toHaveBeenCalledWith(
        'Apply or cancel the active CAD command before closing or replacing this project.',
      );
      expect(confirmDirty).not.toHaveBeenCalled();
      expect(clearRecovery).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(project).toEqual(original);
      expect(command.current()).toBe(draft);

      // Resolving the command restores the existing clean/dirty close policy.
      drafts.delete(command.clear()!);
      expect(await closeProjectDocument({ canReplace, clearRecovery, close })).toBe(true);
      expect(confirmDirty).toHaveBeenCalledTimes(dirty ? 1 : 0);
      expect(clearRecovery).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('leaves ordinary numerical draft replacement decisions with the existing dirty policy', () => {
    const drafts = new Map([
      ['numeric-radius', 'Radius'],
      ['cad-sketch', 'Finish or cancel the current sketch gesture'],
    ]);
    expect(projectReplacementIssue(drafts)).toBeNull();
    expect(drafts.size).toBe(2);
    drafts.set('cad-command:owned:input:radius', 'Radius');
    expect(projectReplacementIssue(drafts)).toContain('Apply or cancel');
    expect(drafts.size).toBe(3);
  });

  it('preserves unsaved definition, copy and client when native close admission fails before confirmation', async () => {
    const canReplace = vi.fn(async () => true);
    const clearRecovery = vi.fn(async () => {});
    const close = vi.fn();
    await expect(
      closeProjectDocument({
        prepareClose: async () => {
          throw new Error('Document session limit reached');
        },
        canReplace,
        clearRecovery,
        close,
      }),
    ).rejects.toThrow('session limit');
    expect(canReplace).not.toHaveBeenCalled();
    expect(clearRecovery).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('closes a saved project only after recovery cleanup finishes', async () => {
    const order: string[] = [];
    expect(
      await closeProjectDocument({
        prepareClose: async () => {
          order.push('native admission');
        },
        canReplace: async () => {
          order.push('confirmed');
          return true;
        },
        clearRecovery: async () => {
          order.push('cleanup');
        },
        close: () => {
          order.push('reset definition, history, results and file association');
        },
      }),
    ).toBe(true);
    expect(order).toEqual([
      'native admission',
      'confirmed',
      'cleanup',
      'reset definition, history, results and file association',
    ]);
  });

  it('keeps the project and recovery data when cancellation or a failed Save denies replacement', async () => {
    const clearRecovery = vi.fn(async () => {});
    const close = vi.fn();
    expect(
      await closeProjectDocument({ canReplace: async () => false, clearRecovery, close }),
    ).toBe(false);
    expect(clearRecovery).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('preserves the open project when recovery cleanup fails', async () => {
    const close = vi.fn();
    await expect(
      closeProjectDocument({
        canReplace: async () => true,
        clearRecovery: async () => {
          throw new Error('disk unavailable');
        },
        close,
      }),
    ).rejects.toThrow('disk unavailable');
    expect(close).not.toHaveBeenCalled();
  });
});
