import { File, House, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Project } from '../domain/contracts/types';
import { makeProject, type ExampleId } from '../features/examples/projects';
import { loadReference, type ReferenceId } from '../features/examples/references';
import HelpPanel from '../features/help/HelpPanel';
import type { HelpContext } from '../features/help/content';
import RecoveryDialog from '../features/project/RecoveryDialog';
import ProjectStartCenter from '../features/workbench/ProjectStartCenter';
import WorkbenchHeader from '../features/workbench/WorkbenchHeader';
import { useTheme } from '../features/workbench/theme';
import { closeProject, openProject } from '../platform/desktop/bridge';
import type { RecoveryRecord } from '../platform/desktop/recovery';
import { invokeVerification } from '../platform/desktop/verification';
import { useModalFocus } from '../shared/ui/useModalFocus';
import ProjectDocumentWorkspace from './ProjectDocumentWorkspace';
import {
  newProjectDocument,
  ProjectDocuments,
  type ProjectDocumentSeed,
  type ProjectDocumentSnapshot,
} from './projectDocuments';
import { useDesktopLifecycle } from './useDesktopLifecycle';
import { useRecoverySession } from './useRecoverySession';
import { useNativeActivity } from './workbenchActivity';
import './DocumentTabs.css';

export interface AppProps {
  onActiveDocument?: (snapshot: ProjectDocumentSnapshot | null) => void;
  assistantPanel?: ReactNode;
  onAssistantOpen?: () => void;
  overlayModalOpen?: boolean;
}

export default function App({
  onActiveDocument,
  assistantPanel,
  onAssistantOpen,
  overlayModalOpen = false,
}: AppProps = {}) {
  const desktop = '__TAURI_INTERNALS__' in window;
  const appearance = useTheme();
  const nativeActivity = useNativeActivity();
  const [documents] = useState(() => new ProjectDocuments());
  const state = useSyncExternalStore(documents.subscribe, documents.getSnapshot);
  const [homeId] = useState(() => crypto.randomUUID());
  const [homeDefinition] = useState<Project>(() => makeProject());
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [windowClosing, setWindowClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeHelp, setHomeHelp] = useState<HelpContext | null>(null);
  const [verification, setVerification] = useState(false);
  const openingRef = useRef(false);
  const activeEntry = state.documents.find((entry) => entry.seed.id === state.activeId);
  const active = activeEntry?.snapshot ?? null;
  const activeController = () => documents.controller(documents.getSnapshot().activeId);
  const nativeOwner = state.documents.find(
    (entry) => entry.snapshot?.busy || entry.snapshot?.fileBusy || entry.snapshot?.deviceBusy,
  );
  const nativeBusy = opening || !!nativeOwner;
  const documentModal = state.documents.some(
    (entry) => entry.snapshot?.confirmation || entry.snapshot?.help,
  );
  const documentTransition = state.documents.some((entry) => entry.snapshot?.transitioning);
  const recovery = useRecoverySession({
    documentId: homeId,
    desktop,
    verification,
    project: homeDefinition,
    dirty: false,
    invalidDrafts: 0,
    blocked: opening || windowClosing || documentTransition,
    onRestore: () => {},
    onError: setError,
  });
  const modalOpen =
    overlayModalOpen ||
    newProjectOpen ||
    !!homeHelp ||
    documentModal ||
    recovery.prompt ||
    recovery.pending ||
    !recovery.ready ||
    documentTransition;
  useModalFocus(
    !!homeHelp || recovery.prompt,
    () => {
      if (homeHelp) setHomeHelp(null);
      else if (!recovery.pending) recovery.setPrompt(false);
    },
    homeHelp ? 'home-help' : recovery.prompt ? 'home-recovery' : null,
  );

  useEffect(() => {
    onActiveDocument?.(active);
  }, [active, onActiveDocument]);
  useEffect(() => {
    if (documentModal || recovery.prompt || homeHelp) setNewProjectOpen(false);
  }, [documentModal, recovery.prompt, homeHelp]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void invokeVerification('verification_configuration')
      .then((configuration) => {
        if (disposed || !configuration) return;
        setVerification(true);
        documents.add({ ...newProjectDocument(), dirty: false, verification: true });
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, [desktop, documents]);

  const requestNew = useCallback(() => {
    if (
      windowClosing ||
      overlayModalOpen ||
      homeHelp ||
      openingRef.current ||
      documentModal ||
      recovery.prompt ||
      !recovery.ready ||
      documentTransition
    )
      return;
    documents.focus(null);
    setNewProjectOpen(true);
  }, [
    documents,
    windowClosing,
    documentModal,
    recovery.prompt,
    recovery.ready,
    documentTransition,
    overlayModalOpen,
    homeHelp,
  ]);
  const add = (seed: ProjectDocumentSeed): boolean => {
    try {
      documents.add(seed);
      setError(null);
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    }
  };
  const create = async (name: string, dimension: '2d' | '3d') =>
    !overlayModalOpen && !windowClosing && add(newProjectDocument(name, dimension));
  const example = async (id: ExampleId) =>
    !overlayModalOpen && !windowClosing && add(newProjectDocument(undefined, '3d', id));
  const open = async (): Promise<boolean> => {
    if (
      !desktop ||
      overlayModalOpen ||
      openingRef.current ||
      nativeActivity.execution.current ||
      nativeActivity.file.current ||
      nativeActivity.device.current ||
      windowClosing ||
      documentModal
    )
      return false;
    openingRef.current = true;
    nativeActivity.file.current = 'open';
    setOpening(true);
    const documentId = crypto.randomUUID();
    try {
      const opened = await openProject(documentId);
      if (!opened) return false;
      if ('existingDocumentId' in opened) {
        if (!documents.focus(opened.existingDocumentId))
          throw new Error('The existing project document is no longer available. Reopen it.');
        return true;
      }
      const added = add({
        id: documentId,
        project: opened.project,
        path: opened.path,
        data:
          opened.manifest && opened.buffer
            ? { manifest: opened.manifest, buffer: opened.buffer }
            : null,
        dirty: false,
        notice: opened.notice,
      });
      if (!added) await closeProject(documentId);
      return added;
    } catch (cause) {
      // Native open may have associated the file before its validated binary
      // buffer failed to load. Retire that unmounted document before retrying.
      try {
        await closeProject(documentId);
      } catch (cleanup) {
        setError(`Project open failed: ${String(cause)}. File cleanup failed: ${String(cleanup)}`);
        return false;
      }
      setError(String(cause));
      return false;
    } finally {
      openingRef.current = false;
      nativeActivity.file.current = null;
      setOpening(false);
    }
  };
  const reference = async (id: ReferenceId) => {
    if (overlayModalOpen || openingRef.current || windowClosing) return;
    setOpening(true);
    openingRef.current = true;
    try {
      const saved = await loadReference(id);
      add({
        id: crypto.randomUUID(),
        project: saved.project,
        data: saved.data,
        dirty: false,
        referenceId: id,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  const canCloseDocument = (snapshot: ProjectDocumentSnapshot | null) =>
    !!snapshot &&
    !overlayModalOpen &&
    !snapshot.busy &&
    !snapshot.deviceBusy &&
    !snapshot.transitioning &&
    (!snapshot.fileBusy || snapshot.autosaveStatus === 'saving') &&
    snapshot.recoveryReady &&
    !snapshot.recoveryPending &&
    !snapshot.confirmation &&
    !snapshot.help &&
    !documentModal &&
    !documentTransition &&
    !opening &&
    !newProjectOpen &&
    !homeHelp &&
    !recovery.prompt &&
    !windowClosing;
  const closeDocument = async (id = documents.getSnapshot().activeId): Promise<void> => {
    if (!id) return;
    const entry = documents.getSnapshot().documents.find((item) => item.seed.id === id);
    if (!canCloseDocument(entry?.snapshot ?? null)) return;
    documents.focus(id);
    if (!(await documents.close(id))) return;
    requestAnimationFrame(() =>
      document
        .getElementById(
          documents.getSnapshot().activeId
            ? `document-tab-${documents.getSnapshot().activeId}`
            : 'home-tab',
        )
        ?.focus(),
    );
  };
  const canCloseWindow = async (): Promise<boolean> => {
    if (overlayModalOpen || nativeActivity.closing.current) return false;
    nativeActivity.closing.current = true;
    setWindowClosing(true);
    let approved = false;
    try {
      for (const entry of documents.getSnapshot().documents) {
        const controller = documents.controller(entry.seed.id);
        if (!controller) return false;
        if (controller.dirtyRef.current) documents.focus(entry.seed.id);
        if (!(await controller.canReplaceRef.current())) return false;
      }
      approved = true;
      return true;
    } finally {
      if (!approved) {
        nativeActivity.closing.current = false;
        setWindowClosing(false);
      }
    }
  };
  const showHelp = () => {
    const controller = activeController();
    if (controller) controller.showHelp();
    else setHomeHelp('overview');
  };
  useDesktopLifecycle({
    desktop,
    active,
    nativeActivity,
    modalOpen,
    anyDirty: state.documents.some((entry) => entry.snapshot?.dirty ?? entry.seed.dirty),
    onNew: requestNew,
    onOpen: open,
    onSave: async (as) => (await activeController()?.save(as)) ?? false,
    onCloseDocument: () => closeDocument(),
    onHelp: showHelp,
    onUndo: () => activeController()?.undo(),
    onRedo: () => activeController()?.redo(),
    canCloseWindow,
    onWindowCloseFailed: () => {
      nativeActivity.closing.current = false;
      setWindowClosing(false);
    },
    onError: setError,
  });
  const restored = async () => {
    recovery.setPrompt(false);
    try {
      await recovery.refresh();
    } catch (cause) {
      setError(String(cause));
    }
  };
  const restore = (record: RecoveryRecord) => {
    const seed = newProjectDocument();
    seed.dirty = false;
    seed.recoveryRecord = record;
    add(seed);
  };

  return (
    <div className={`app-shell${state.activeId === null ? ' home-open' : ''}`}>
      <WorkbenchHeader
        hasProject={!!active}
        canClose={canCloseDocument(active)}
        canUndo={!!active?.canUndo && !active.historyBlocked}
        canRedo={!!active?.canRedo && !active.historyBlocked}
        undoLabel={active?.undoLabel ?? ''}
        redoLabel={active?.redoLabel ?? ''}
        onUndo={() => activeController()?.undo()}
        onRedo={() => activeController()?.redo()}
        locked={opening || modalOpen || windowClosing}
        canUseFiles={desktop && !nativeBusy}
        canSave={
          !!active && !active.locked && !active.nativeLocked && !active.validation && desktop
        }
        canExport={!!active?.solved && !active.locked && !active.nativeLocked && desktop}
        preference={appearance.preference}
        onTheme={appearance.setPreference}
        onNew={requestNew}
        onOpen={() => void open()}
        onClose={() => void closeDocument()}
        onSave={(as) => void activeController()?.save(as)}
        onExport={() => void activeController()?.exportFields()}
        onHelp={showHelp}
        onFilesHelp={() => {
          const controller = activeController();
          if (controller) controller.showHelp('files');
          else setHomeHelp('files');
        }}
        onCommands={
          active
            ? () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
            : undefined
        }
        onAssistantOpen={onAssistantOpen}
      />
      <nav
        className="project-document-tabs"
        role="tablist"
        aria-label="Open project documents"
        onKeyDown={(event) => {
          if (
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
            modalOpen ||
            windowClosing
          )
            return;
          event.preventDefault();
          const ids = [null, ...state.documents.map((entry) => entry.seed.id)];
          const index = ids.indexOf(state.activeId);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? ids.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
          documents.focus(ids[next]);
          document.getElementById(ids[next] ? `document-tab-${ids[next]}` : 'home-tab')?.focus();
        }}
      >
        <button
          className="project-document-tab home-document-tab"
          id="home-tab"
          role="tab"
          tabIndex={state.activeId === null ? 0 : -1}
          aria-selected={state.activeId === null}
          aria-controls="project-home-panel"
          disabled={modalOpen || windowClosing}
          onClick={() => documents.focus(null)}
        >
          <House size={14} />
          <span>Home</span>
        </button>
        {state.documents.map((entry) => (
          <div
            key={entry.seed.id}
            className={`project-tab-item${state.activeId === entry.seed.id ? ' active' : ''}`}
            role="presentation"
          >
            <button
              className="project-document-tab"
              id={`document-tab-${entry.seed.id}`}
              role="tab"
              tabIndex={state.activeId === entry.seed.id ? 0 : -1}
              aria-selected={state.activeId === entry.seed.id}
              aria-controls={`document-panel-${entry.seed.id}`}
              title={entry.snapshot?.path ?? entry.seed.path ?? 'Unsaved project draft'}
              disabled={modalOpen || windowClosing}
              onClick={() => documents.focus(entry.seed.id)}
            >
              <File size={14} />
              <span>{entry.snapshot?.project.name ?? entry.seed.project.name}</span>
              {(entry.snapshot?.dirty ?? entry.seed.dirty) && (
                <span className="tab-dirty-dot" aria-label="Unsaved changes" />
              )}
              {entry.snapshot?.busy && <span className="spinner" />}
            </button>
            <button
              className="project-tab-close"
              disabled={!canCloseDocument(entry.snapshot)}
              aria-label={`Close ${entry.snapshot?.project.name ?? entry.seed.project.name}`}
              title="Close this project"
              onClick={() => void closeDocument(entry.seed.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {nativeOwner?.snapshot?.busy && (
          <span className="document-worker-status" role="status">
            Worker: {nativeOwner.snapshot.project.name}
          </span>
        )}
      </nav>
      <section
        className="project-start-tab"
        id="project-home-panel"
        role="tabpanel"
        aria-labelledby="home-tab"
        hidden={state.activeId !== null}
      >
        <ProjectStartCenter
          desktop={desktop}
          canOpen={desktop && !nativeBusy}
          locked={
            overlayModalOpen ||
            opening ||
            windowClosing ||
            documentModal ||
            recovery.prompt ||
            !recovery.ready
          }
          hasProject={state.documents.length > 0}
          projectName=""
          projectPath={null}
          dirty={false}
          openProjects={state.documents.map((entry) => ({
            id: entry.seed.id,
            name: entry.snapshot?.project.name ?? entry.seed.project.name,
            path: entry.snapshot?.path ?? entry.seed.path ?? null,
            dirty: entry.snapshot?.dirty ?? entry.seed.dirty,
          }))}
          onContinueDocument={(id) => documents.focus(id)}
          error={error}
          newProjectOpen={newProjectOpen}
          onRequestNew={requestNew}
          onCancelNew={() => setNewProjectOpen(false)}
          onContinue={() => {
            if (state.documents[0]) documents.focus(state.documents[0].seed.id);
          }}
          onNew={create}
          onOpen={open}
          onExample={example}
          onReference={reference}
          onHelp={() => setHomeHelp('overview')}
          onDismissError={() => setError(null)}
        />
      </section>
      {state.documents.map((entry) => (
        <ProjectDocumentWorkspace
          key={entry.seed.id}
          seed={entry.seed}
          active={state.activeId === entry.seed.id}
          documents={documents}
          nativeActivity={nativeActivity}
          appearance={appearance}
          windowClosing={windowClosing}
          modalBlocked={overlayModalOpen}
          onNew={requestNew}
          onOpen={open}
          onAssistantOpen={onAssistantOpen}
          onRecoveryRestored={() => void restored()}
          onRecoveryFailed={(message) => {
            setError(message);
            documents.remove(entry.seed.id);
          }}
        />
      ))}
      {recovery.prompt && !homeHelp && (
        <RecoveryDialog
          records={recovery.records}
          pending={
            recovery.pending ||
            state.documents.some(
              (entry) =>
                !!entry.seed.recoveryRecord &&
                (entry.snapshot?.recoveryPending || !entry.snapshot?.recoveryReady),
            )
          }
          onRestore={restore}
          onDiscard={(record) => void recovery.discard(record)}
          onLater={() => recovery.setPrompt(false)}
        />
      )}
      {homeHelp && (
        <div className="modal-backdrop help-backdrop">
          <div
            className="modal help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Phyra help"
          >
            <HelpPanel open context={homeHelp} onClose={() => setHomeHelp(null)} />
          </div>
        </div>
      )}
      {assistantPanel}
    </div>
  );
}
