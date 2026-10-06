import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AssistantSnapshot } from '../domain/assistant/types';
import App from './App';
import type { ProjectDocumentSnapshot } from './projectDocuments';
const AssistantPanel = lazy(() => import('../features/assistant/AssistantPanel'));
import AssistantMcpPanel from '../features/assistant/AssistantMcpPanel';
import { helpDocument } from '../features/assistant/context';
import HelpPanel from '../features/help/HelpPanel';
import { helpArticles, type HelpArticleId } from '../features/help/content';
import { useAssistantMcp } from '../features/assistant/session/useAssistantMcp';
import { useModalFocus } from '../shared/ui/useModalFocus';
import { assistantStudyContext } from './assistantStudyContext';
import { useAssistantSession } from './useAssistantSession';

export default function AssistantWorkbench() {
  const desktop = '__TAURI_INTERNALS__' in window;
  const [active, setActive] = useState<ProjectDocumentSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{
    id: string;
    documentId: string | null;
    question: string;
    includeStudy: boolean;
  } | null>(null);
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  useEffect(() => {
    if (open) setAssistantLoaded(true);
  }, [open]);
  const [settingsModal, setSettingsModal] = useState(false);
  const [source, setSource] = useState<HelpArticleId | null>(null);
  const session = useAssistantSession(
    active?.documentId ?? 'home',
    active?.project.id ?? null,
    desktop && assistantLoaded,
  );
  const openAssistant = useCallback(
    (question?: string, includeStudy = false) => {
      if (typeof question === 'string')
        setDraft({
          id: crypto.randomUUID(),
          documentId: active?.documentId ?? null,
          question,
          includeStudy,
        });
      setOpen(true);
    },
    [active?.documentId],
  );
  const study = useMemo(() => assistantStudyContext(active), [active]);
  const snapshot = useMemo<AssistantSnapshot>(
    () => ({
      sessionId: session.sessionId,
      projectId: active && !active.validation ? active.project.id : null,
      revision: active && !active.validation ? active.project.revision : null,
      project: active && !active.validation ? active.project : null,
      run: active && !active.validation ? (study?.run ?? null) : null,
      cad: active && !active.validation ? (study?.cad ?? null) : null,
      help: helpArticles.map((article) => ({
        id: article.id,
        title: article.title,
        content: helpDocument(article),
      })),
      capabilities: [
        {
          id: 'cad-evidence',
          description:
            'Authored feature graph and bounded exact-output measurements, sketch DOF and solver compatibility; no CAD source bytes or preview arrays',
          available: !!study?.cad && !active?.validation,
        },
        {
          id: 'documentation',
          description: 'Versioned offline product help and mathematical formulations',
          available: true,
        },
        {
          id: 'active-project',
          description: 'Validated active project definition in SI',
          available: !!active && !active.validation,
        },
        {
          id: 'run-summary',
          description: 'Exact job identifiers and bounded numerical summary; no field buffers',
          available: !!study?.run,
        },
        {
          id: 'model-mutations',
          description:
            'Assistant model editing and solver launch are unavailable in this iteration',
          available: false,
        },
      ],
    }),
    [active, study, session.sessionId],
  );
  const mcp = useAssistantMcp(snapshot, desktop);
  useModalFocus(!!source, () => setSource(null), 'assistant-source');
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        if (document.querySelector('.modal')) return;
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape' && open && !document.querySelector('.modal')) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  useEffect(() => {
    if (active?.confirmation || active?.help) {
      setOpen(false);
      setSource(null);
    }
  }, [active?.confirmation, active?.help]);
  function cite(id: string) {
    if (helpArticles.some((article) => article.id === id)) setSource(id as HelpArticleId);
  }
  return (
    <App
      assistantOpen={open}
      overlayModalOpen={settingsModal || !!source}
      onActiveDocument={setActive}
      onAssistantOpen={openAssistant}
      assistantPanel={
        <>
          {assistantLoaded && (
            <Suspense fallback={null}>
              <AssistantPanel
                open={open}
                desktop={desktop}
                study={study}
                draft={draft}
                session={session}
                onClose={() => setOpen(false)}
                onSource={cite}
                onModalChange={setSettingsModal}
                mcpPanel={
                  desktop ? (
                    <AssistantMcpPanel
                      configuration={mcp.configuration}
                      audit={mcp.audit}
                      busy={mcp.busy}
                      auditBusy={mcp.auditBusy}
                      clientBusy={mcp.clientBusy}
                      error={mcp.error}
                      activeName={active?.project.name ?? null}
                      onConfigure={(tools) => void mcp.configure(tools)}
                      onAudit={() => void mcp.readAudit()}
                      onOpenClient={() => void mcp.openClient()}
                    />
                  ) : undefined
                }
              />
            </Suspense>
          )}
          {source && (
            <div className="modal-backdrop help-backdrop">
              <div
                className="modal help-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Assistant source documentation"
              >
                <HelpPanel open articleId={source} onClose={() => setSource(null)} />
              </div>
            </div>
          )}
        </>
      }
    />
  );
}
