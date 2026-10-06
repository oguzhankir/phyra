import type { RefObject } from 'react';
import type { ProjectDefinition as Project } from '../domain/contracts/types';
import type { ResultData } from '../domain/results/fields';
import type { ResultInspection } from '../domain/results/inspection';
import { makeProject, type ExampleId } from '../features/examples/projects';
import type { ReferenceId } from '../features/examples/references';
import type { RecoveryRecord } from '../platform/desktop/recovery';
import type { Workbench } from './useWorkbench';
import { blankProject } from '../domain/project/document';
import type { CadReceipt } from '../platform/desktop/cad';

export interface ProjectDocumentSeed {
  id: string;
  project: Project;
  path?: string | null;
  data?: ResultData | null;
  dirty: boolean;
  referenceId?: ReferenceId;
  recoveryRecord?: RecoveryRecord;
  verification?: boolean;
  notice?: string;
}

export type ProjectDocumentSnapshot = Pick<
  Workbench,
  | 'project'
  | 'path'
  | 'dirty'
  | 'section'
  | 'currentData'
  | 'runExecution'
  | 'runStatus'
  | 'progress'
  | 'error'
  | 'notice'
  | 'busy'
  | 'fileBusy'
  | 'deviceBusy'
  | 'transitioning'
  | 'autosaveStatus'
  | 'confirmation'
  | 'help'
  | 'validation'
  | 'solved'
  | 'canUndo'
  | 'canRedo'
  | 'undoLabel'
  | 'redoLabel'
  | 'historyBlocked'
  | 'locked'
  | 'nativeLocked'
  | 'cadBusy'
  | 'preparation'
> & {
  documentId: string;
  recoveryReady: boolean;
  recoveryPending: boolean;
  inspection: ResultInspection | null;
  cad: {
    busy: boolean;
    receipt: CadReceipt | null;
    sketchSolve?: {
      featureId: string;
      report: {
        status: string;
        degreesOfFreedom: number | null;
        failedConstraintIds: string[];
        kernel: string;
        sourceCommit: string;
      };
    } | null;
  };
};

export interface ProjectDocumentEntry {
  seed: ProjectDocumentSeed;
  snapshot: ProjectDocumentSnapshot | null;
}

export interface ProjectDocumentsState {
  activeId: string | null;
  documents: ProjectDocumentEntry[];
}

// A document's mounted session owns its state; this collection only owns tab
// identity, ordering and stable controller references. Focusing never replaces it.
export class ProjectDocuments {
  private state: ProjectDocumentsState = { activeId: null, documents: [] };
  private listeners = new Set<() => void>();
  private controllers = new Map<string, RefObject<Workbench | null>>();
  private closing = new Map<string, Promise<boolean>>();

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: ProjectDocumentsState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  add(seed: ProjectDocumentSeed) {
    if (this.state.documents.some((document) => document.seed.id === seed.id))
      throw new Error('This project document is already open.');
    if (this.state.documents.length >= 32)
      throw new Error('Close a project before opening more than 32 documents.');
    this.publish({
      activeId: seed.id,
      documents: [...this.state.documents, { seed, snapshot: null }],
    });
  }
  focus(id: string | null) {
    if (id !== null && !this.state.documents.some((entry) => entry.seed.id === id)) return false;
    if (this.state.activeId !== id) this.publish({ ...this.state, activeId: id });
    return true;
  }
  remove(id: string) {
    const index = this.state.documents.findIndex((entry) => entry.seed.id === id);
    if (index < 0) return;
    const documents = this.state.documents.filter((entry) => entry.seed.id !== id);
    const activeId =
      this.state.activeId === id
        ? (documents[Math.max(0, index - 1)]?.seed.id ?? null)
        : this.state.activeId;
    this.controllers.delete(id);
    this.publish({ documents, activeId });
  }
  register(id: string, controller: RefObject<Workbench | null>) {
    this.controllers.set(id, controller);
    // The mounted execution owner has adopted its initial buffer. Keeping that
    // buffer in the tab seed would retain it even after the owner replaces it.
    const index = this.state.documents.findIndex((entry) => entry.seed.id === id);
    if (index >= 0 && this.state.documents[index].seed.data) {
      const documents = [...this.state.documents];
      documents[index] = {
        ...documents[index],
        seed: { ...documents[index].seed, data: undefined },
      };
      this.publish({ ...this.state, documents });
    }
    return () => {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    };
  }
  controller(id: string | null) {
    return id ? (this.controllers.get(id)?.current ?? null) : null;
  }
  close(id: string): Promise<boolean> {
    const pending = this.closing.get(id);
    if (pending) return pending;
    const controller = this.controller(id);
    if (!controller) return Promise.resolve(false);
    const closing = (async () => {
      if (!(await controller.close())) return false;
      this.remove(id);
      return true;
    })();
    this.closing.set(id, closing);
    void closing
      .finally(() => {
        if (this.closing.get(id) === closing) this.closing.delete(id);
      })
      .catch(() => undefined);
    return closing;
  }
  update(snapshot: ProjectDocumentSnapshot) {
    const index = this.state.documents.findIndex((entry) => entry.seed.id === snapshot.documentId);
    if (index < 0) return;
    const previous = this.state.documents[index].snapshot;
    if (
      previous &&
      Object.keys(snapshot).every((key) =>
        Object.is(
          previous[key as keyof ProjectDocumentSnapshot],
          snapshot[key as keyof ProjectDocumentSnapshot],
        ),
      )
    )
      return;
    const documents = [...this.state.documents];
    documents[index] = { ...documents[index], snapshot };
    this.publish({ ...this.state, documents });
  }
}

export function newProjectDocument(
  name?: string,
  dimension: '2d' | '3d' = '3d',
  example?: ExampleId,
): ProjectDocumentSeed {
  const project = example ? makeProject(example) : blankProject(name, dimension);
  return { id: crypto.randomUUID(), project, dirty: true };
}
