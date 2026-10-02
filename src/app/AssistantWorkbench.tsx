import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssistantMcpAudit,
  AssistantMcpConfiguration,
  AssistantMcpScope,
  AssistantSnapshot,
} from '../domain/assistant/types';
import App from './App';
import type { ProjectDocumentSnapshot } from './projectDocuments';
const AssistantPanel = lazy(() => import('../features/assistant/AssistantPanel'));
import AssistantMcpPanel from '../features/assistant/AssistantMcpPanel';
import { helpDocument } from '../features/assistant/context';
import HelpPanel from '../features/help/HelpPanel';
import { helpArticles, type HelpArticleId } from '../features/help/content';
import {
  configureAssistantMcp,
  getAssistantMcpAudit,
  publishAssistantSnapshot,
} from '../platform/desktop/assistant';
import { useModalFocus } from '../shared/ui/useModalFocus';
import { assistantStudyContext } from './assistantStudyContext';
import { useAssistantSession } from './useAssistantSession';

export default function AssistantWorkbench() {
  const desktop = '__TAURI_INTERNALS__' in window;
  const [active, setActive] = useState<ProjectDocumentSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  useEffect(() => {
    if (open) setAssistantLoaded(true);
  }, [open]);
  const [settingsModal, setSettingsModal] = useState(false);
  const [source, setSource] = useState<HelpArticleId | null>(null);
  const [mcp, setMcp] = useState<AssistantMcpConfiguration | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AssistantMcpAudit[]>([]);
  const session = useAssistantSession(
    active?.documentId ?? 'home',
    active?.project.id ?? null,
    desktop && assistantLoaded,
  );
  const openAssistant = useCallback(() => setOpen(true), []);
  const study = useMemo(() => assistantStudyContext(active), [active]);
  const snapshot = useMemo<AssistantSnapshot>(
    () => ({
      sessionId: session.sessionId,
      projectId: active && !active.validation ? active.project.id : null,
      revision: active && !active.validation ? active.project.revision : null,
      project: active && !active.validation ? active.project : null,
      run: active && !active.validation ? (study?.run ?? null) : null,
      help: helpArticles.map((article) => ({
        id: article.id,
        title: article.title,
        content: helpDocument(article),
      })),
      capabilities: [
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
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const mcpRef = useRef(mcp);
  mcpRef.current = mcp;
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
  useEffect(() => {
    if (!desktop || !mcp?.enabled) return;
    const publish = () =>
      void publishAssistantSnapshot(snapshotRef.current).catch((failure) =>
        setMcpError(
          typeof failure === 'string' ? failure : 'The MCP snapshot could not be refreshed.',
        ),
      );
    publish();
    const timer = window.setInterval(publish, 30000);
    return () => window.clearInterval(timer);
  }, [desktop, mcp?.enabled, snapshot]);
  async function configure(scopes: AssistantMcpScope[]) {
    setMcpBusy(true);
    setMcpError(null);
    try {
      // Revocation must work even if a snapshot is invalid or storage/keychain is unavailable.
      if (scopes.length) await publishAssistantSnapshot(snapshotRef.current);
      const value = await configureAssistantMcp(session.sessionId, scopes);
      setMcp(value);
      setAudit([]);
    } catch (failure) {
      setMcpError(typeof failure === 'string' ? failure : 'MCP access could not be configured.');
    } finally {
      setMcpBusy(false);
    }
  }
  function readAudit() {
    void getAssistantMcpAudit(session.sessionId)
      .then(setAudit)
      .catch((failure) =>
        setMcpError(typeof failure === 'string' ? failure : 'The MCP audit is unavailable.'),
      );
  }
  function cite(id: string) {
    if (helpArticles.some((article) => article.id === id)) setSource(id as HelpArticleId);
  }
  return (
    <App
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
                session={session}
                onClose={() => setOpen(false)}
                onSource={cite}
                onModalChange={setSettingsModal}
                mcpPanel={
                  desktop ? (
                    <AssistantMcpPanel
                      configuration={mcp}
                      audit={audit}
                      busy={mcpBusy}
                      error={mcpError}
                      activeName={active?.project.name ?? null}
                      onConfigure={(scopes) => void configure(scopes)}
                      onAudit={readAudit}
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
