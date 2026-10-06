import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../domain/contracts/types';
import { createHistory, recordEdit, undo } from '../domain/project/history';
import { ExecutionOwnership } from './executionOwnership';
import {
  newProjectDocument,
  ProjectDocuments,
  type ProjectDocumentSeed,
  type ProjectDocumentSnapshot,
} from './projectDocuments';
import type { Workbench } from './useWorkbench';

function snapshot(seed: ProjectDocumentSeed, changes: Partial<ProjectDocumentSnapshot> = {}) {
  return {
    documentId: seed.id,
    project: seed.project,
    path: seed.path ?? null,
    dirty: seed.dirty,
    section: 'study',
    currentData: null,
    runStatus: 'idle',
    busy: null,
    ...changes,
  } as ProjectDocumentSnapshot;
}

function controller(close = vi.fn(async () => true)) {
  return { current: { close } as unknown as Workbench };
}

describe('independent mounted project documents', () => {
  it('does not republish unchanged narrow CAD state when a mounted document rerenders', () => {
    const documents = new ProjectDocuments();
    const seed = newProjectDocument('Blank CAD');
    documents.add(seed);
    const onPublication = vi.fn();
    documents.subscribe(onPublication);
    const idleCad = { busy: false, receipt: null, sketchSolve: null };
    const idle = snapshot(seed, { cad: idleCad });
    documents.update(idle);
    const accepted = documents.getSnapshot();
    // App composition must memoize this nested adapter. Fresh outer status
    // snapshots are normal on rerenders; unchanged CAD evidence is not a change.
    for (let render = 0; render < 8; render++) documents.update({ ...idle, cad: idleCad });
    expect(documents.getSnapshot()).toBe(accepted);
    expect(onPublication).toHaveBeenCalledTimes(1);
    const busyCad = { ...idleCad, busy: true };
    documents.update({ ...idle, cad: busyCad });
    for (let render = 0; render < 8; render++) documents.update({ ...idle, cad: busyCad });
    expect(onPublication).toHaveBeenCalledTimes(2);
    expect(documents.getSnapshot().documents[0].snapshot?.cad.busy).toBe(true);
  });
  it('creates fresh project, study and document identities from blank and example starts', () => {
    const first = newProjectDocument('First', '2d');
    const second = newProjectDocument(undefined, '3d', 'cantilever');
    const third = newProjectDocument(undefined, '3d', 'cantilever');
    expect(first.project.geometry).toEqual({ kind: 'empty', dimension: '2d' });
    expect(first.project.study).toBeNull();
    expect(first.project.name).toBe('First');
    for (const key of ['id'] as const)
      expect(new Set([first[key], second[key], third[key]]).size).toBe(3);
    expect(new Set([first.project.id, second.project.id, third.project.id]).size).toBe(3);
    expect(new Set([second.project.study!.id, third.project.study!.id]).size).toBe(2);
    expect(second.project.study!.constraints[0].id).not.toBe(
      third.project.study!.constraints[0].id,
    );
    second.project.study!.material.young = 10;
    expect(third.project.study!.material.young).not.toBe(10);
  });

  it('focusing Home and other tabs retains each controller, view, archive and edit history', () => {
    const documents = new ProjectDocuments();
    const a = newProjectDocument('A', '3d', 'cantilever');
    const b = newProjectDocument('B');
    const historyA = createHistory(a.project);
    const nextA = structuredClone(a.project);
    if (nextA.geometry.kind === 'box') nextA.geometry.length *= 2;
    const edited = recordEdit(historyA, a.project, nextA, true);
    const aController = controller();
    const bController = controller();
    documents.add(a);
    documents.register(a.id, aController);
    documents.update(
      snapshot(a, { project: edited.project, path: '/a.phyra', section: 'geometry' }),
    );
    documents.add(b);
    documents.register(b.id, bController);
    documents.update(snapshot(b, { path: '/b.phyra', section: 'material' }));
    const retained = documents.getSnapshot().documents;
    documents.focus(null);
    documents.focus(b.id);
    documents.focus(a.id);
    expect(documents.getSnapshot().documents).toBe(retained);
    expect(documents.controller(a.id)).toBe(aController.current);
    expect(documents.controller(b.id)).toBe(bController.current);
    expect(retained[0].snapshot?.section).toBe('geometry');
    expect(retained[1].snapshot?.section).toBe('material');
    expect(retained.map((item) => item.snapshot?.path)).toEqual(['/a.phyra', '/b.phyra']);
    const undone = undo(edited.history, edited.project);
    expect(undone.project.geometry).toEqual(a.project.geometry);
    expect(undone.project.id).toBe(a.project.id);
    expect(retained[1].snapshot?.project).toBe(b.project);
  });

  it('publishes background work only into its own document while another tab is focused', () => {
    const documents = new ProjectDocuments();
    const a = newProjectDocument('A');
    const b = newProjectDocument('B');
    documents.add(a);
    documents.update(snapshot(a));
    documents.add(b);
    documents.update(snapshot(b));
    const bSnapshot = documents.getSnapshot().documents[1].snapshot;
    const ownA = new ExecutionOwnership();
    const ownB = new ExecutionOwnership();
    const requestA = ownA.begin(structuredClone(a.project), 'solve');
    expect(ownA.event(requestA.requestId, 'a-worker')).toBe(requestA);
    expect(ownB.event(requestA.requestId, 'a-worker')).toBeNull();
    documents.update(snapshot(a, { section: 'results', runStatus: 'completed' }));
    expect(documents.getSnapshot().activeId).toBe(b.id);
    expect(documents.getSnapshot().documents[1].snapshot).toBe(bSnapshot);
    expect(documents.getSnapshot().documents[0].snapshot?.runStatus).toBe('completed');
  });

  it('updates only the matching document and avoids redundant or removed-document publication', () => {
    const documents = new ProjectDocuments();
    const a = newProjectDocument('A');
    const b = newProjectDocument('B');
    documents.add(a);
    documents.add(b);
    const listener = vi.fn();
    const unsubscribe = documents.subscribe(listener);
    const owned = snapshot(a);
    documents.update(owned);
    const published = documents.getSnapshot();
    documents.update({ ...owned });
    expect(documents.getSnapshot()).toBe(published);
    expect(listener).toHaveBeenCalledOnce();
    documents.remove(a.id);
    const afterClose = documents.getSnapshot();
    documents.update({ ...owned, dirty: false });
    expect(documents.getSnapshot()).toBe(afterClose);
    expect(afterClose.documents.map((item) => item.seed.id)).toEqual([b.id]);
    unsubscribe();
    documents.focus(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('waits for the owned close, preserves cancellation and failure, and closes one tab once', async () => {
    const documents = new ProjectDocuments();
    const a = newProjectDocument('A');
    const b = newProjectDocument('B');
    documents.add(a);
    documents.add(b);
    const deny = controller(vi.fn(async () => false));
    documents.register(a.id, deny);
    expect(await documents.close(a.id)).toBe(false);
    expect(documents.getSnapshot().documents).toHaveLength(2);
    deny.current.close = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    await expect(documents.close(a.id)).rejects.toThrow('cleanup failed');
    expect(documents.controller(a.id)).toBe(deny.current);
    let finish!: (value: boolean) => void;
    const close = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    deny.current.close = close;
    const closing = documents.close(a.id);
    expect(documents.close(a.id)).toBe(closing);
    expect(documents.getSnapshot().documents).toHaveLength(2);
    documents.focus(b.id);
    finish(true);
    expect(await closing).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(documents.getSnapshot().activeId).toBe(b.id);
    expect(documents.controller(a.id)).toBeNull();
    expect(await documents.close(a.id)).toBe(false);
  });

  it('chooses an adjacent surviving tab when closing the active one, then returns Home', async () => {
    const documents = new ProjectDocuments();
    const seeds = ['A', 'B', 'C'].map((name) => newProjectDocument(name));
    for (const seed of seeds) {
      documents.add(seed);
      documents.register(seed.id, controller());
    }
    documents.focus(seeds[1].id);
    await documents.close(seeds[1].id);
    expect(documents.getSnapshot().activeId).toBe(seeds[0].id);
    await documents.close(seeds[0].id);
    expect(documents.getSnapshot().activeId).toBe(seeds[2].id);
    await documents.close(seeds[2].id);
    expect(documents.getSnapshot()).toEqual({ activeId: null, documents: [] });
  });

  it('stale controller cleanup cannot unregister a newer mounted controller', () => {
    const documents = new ProjectDocuments();
    const seed = newProjectDocument();
    documents.add(seed);
    const old = controller();
    const fresh = controller();
    const unregister = documents.register(seed.id, old);
    documents.register(seed.id, fresh);
    unregister();
    expect(documents.controller(seed.id)).toBe(fresh.current);
  });

  it('releases the initial buffer from tab metadata after its execution owner mounts', () => {
    const documents = new ProjectDocuments();
    const seed = newProjectDocument();
    const initial = {
      manifest: { jobId: 'opaque-transport-fixture', operation: 'mesh' } as Manifest,
      buffer: new ArrayBuffer(8),
    };
    seed.data = initial;
    documents.add(seed);
    documents.register(seed.id, controller());
    documents.update(snapshot(seed, { currentData: initial }));
    expect(documents.getSnapshot().documents[0].seed.data).toBeUndefined();
    expect(documents.getSnapshot().documents[0].snapshot?.currentData).toBe(initial);
  });

  it('rejects duplicate identities, invalid focus and excess documents without replacing existing state', () => {
    const documents = new ProjectDocuments();
    const seeds = Array.from({ length: 32 }, () => newProjectDocument());
    for (const seed of seeds) documents.add(seed);
    const prior = documents.getSnapshot();
    expect(() => documents.add(seeds[0])).toThrow('already open');
    expect(() => documents.add(newProjectDocument())).toThrow('32 documents');
    expect(documents.focus(crypto.randomUUID())).toBe(false);
    expect(documents.getSnapshot()).toBe(prior);
  });
});
