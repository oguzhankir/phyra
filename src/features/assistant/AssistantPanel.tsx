import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Sparkles, Plug, Plus, Settings2, X } from 'lucide-react';
import type { AssistantContext, AssistantSettings } from '../../domain/assistant/types';
import { promptHistory } from '../../domain/assistant/prompt';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { ASSISTANT_SYSTEM, assistantContext, type AssistantStudyContext } from './context';
import { DraftAcceptance } from './draftAcceptance';
import type { AssistantViewModel } from './session/contract';
import AssistantComposer from './AssistantComposer';
import AssistantHistory from './AssistantHistory';
import AssistantTranscript from './AssistantTranscript';
import AssistantSettingsPanel from './AssistantSettingsPanel';
import './AssistantPanel.css';
export type { AssistantViewModel } from './session/contract';

export default function AssistantPanel({
  open,
  desktop,
  study,
  session,
  onClose,
  onSource,
  mcpPanel,
  draft,
  onModalChange,
}: {
  open: boolean;
  desktop: boolean;
  study: AssistantStudyContext | null;
  session: AssistantViewModel;
  onClose: () => void;
  onSource: (id: string) => void;
  mcpPanel?: React.ReactNode;
  draft?: { id: string; documentId: string | null; question: string; includeStudy: boolean } | null;
  onModalChange?: (open: boolean) => void;
}) {
  const consumedDraft = useRef<string | null>(null);
  const draftAcceptance = useRef(new DraftAcceptance());
  draftAcceptance.current.adopt(study?.documentId ?? null, session.conversation.id);
  const [question, setQuestion] = useState('');
  function updateQuestion(value: string) {
    draftAcceptance.current.change();
    setQuestion(value);
  }
  const includeStudy = !!study;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [discardUnsaved, setDiscardUnsaved] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const modalOpen = settingsOpen || integrationsOpen;
  useEffect(() => {
    onModalChange?.(modalOpen);
    return () => onModalChange?.(false);
  }, [modalOpen, onModalChange]);
  useModalFocus(integrationsOpen, () => setIntegrationsOpen(false), 'integrations');
  useEffect(() => {
    updateQuestion('');
    setUiError(null);
    setDiscardUnsaved(false);
  }, [study?.documentId, session.conversation.id]);
  useEffect(() => {
    if (
      draft &&
      draft.id !== consumedDraft.current &&
      draft.documentId === (study?.documentId ?? null)
    ) {
      consumedDraft.current = draft.id;
      updateQuestion(draft.question);
    }
  }, [draft, study?.documentId]);
  useEffect(() => {
    if (!open) {
      setIntegrationsOpen(false);
      setSettingsOpen(false);
    }
  }, [open]);
  const prepared = useMemo(() => {
    try {
      return { context: assistantContext(question, study, includeStudy), error: null };
    } catch (failure) {
      return {
        context: null,
        error: failure instanceof Error ? failure.message : 'Context is unavailable.',
      };
    }
  }, [question, study, includeStudy]);
  const historyInput = prepared.context
    ? promptHistory(
        session.conversation.messages,
        prepared.context.text,
        ASSISTANT_SYSTEM,
        question,
      )
    : null;
  const settings = session.configuration?.settings;
  async function transmit(text: string, context: AssistantContext) {
    setUiError(null);
    const accepted = draftAcceptance.current.capture(() => updateQuestion(''));
    await session.send(text.trim(), context, true, accepted);
  }
  async function submit() {
    if (
      !question.trim() ||
      session.pending ||
      session.historyBusy ||
      session.unsaved ||
      modelBusy ||
      !prepared.context ||
      !historyInput?.fits
    )
      return;
    if (!settings?.model || (!settings.local && !session.configuration?.credentialPresent)) {
      setSettingsOpen(true);
      return;
    }
    setHistoryOpen(false);
    await transmit(question, prepared.context);
  }
  async function selectModel(value: AssistantSettings) {
    if (session.pending || modelBusy) return;
    setModelBusy(true);
    setUiError(null);
    try {
      await session.selectModel(value);
    } finally {
      setModelBusy(false);
    }
  }
  async function refreshModels() {
    if (!settings || session.pending || modelBusy) return;
    setModelBusy(true);
    try {
      await session.refreshModels(settings);
    } finally {
      setModelBusy(false);
    }
  }
  if (!open) return null;
  return (
    <aside className="assistant-panel" aria-label="AI assistant">
      <header className="assistant-header">
        <div className="assistant-heading">
          <span className="assistant-mark">
            <Sparkles size={17} />
          </span>
          <strong>AI assistant</strong>
        </div>
        <div className="assistant-header-actions">
          <button
            type="button"
            onClick={() => {
              session.newConversation();
              setHistoryOpen(false);
            }}
            disabled={session.pending || session.historyBusy || session.unsaved}
            aria-label="New assistant conversation"
            title="New chat"
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            disabled={!desktop}
            aria-pressed={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-label="Conversation history"
            title="Conversations"
          >
            <History size={17} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            disabled={!desktop || session.pending || modelBusy}
            aria-label="AI connections"
            title="AI connections"
          >
            <Settings2 size={17} />
          </button>
          {mcpPanel && (
            <button
              type="button"
              onClick={() => setIntegrationsOpen(true)}
              aria-label="MCP integrations"
              title="Integrations"
            >
              <Plug size={17} />
            </button>
          )}
          <button
            type="button"
            aria-label="Close assistant"
            title="Close · Ctrl/⌘ J"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="assistant-chat-title">
        <strong>
          {session.conversation.messages.length ? session.conversation.title : 'New chat'}
        </strong>
        <span>{study?.project.name ?? 'Workbench'}</span>
      </div>
      {historyOpen ? (
        <AssistantHistory session={session} onClose={() => setHistoryOpen(false)} />
      ) : (
        <AssistantTranscript
          conversation={session.conversation}
          pending={session.pending}
          study={study}
          desktop={desktop}
          onSource={onSource}
          onPrompt={updateQuestion}
          onError={setUiError}
        />
      )}
      {session.unsaved && !session.pending && (
        <section className="assistant-unsaved" aria-label="Unsaved conversation">
          <strong>Conversation not saved</strong>
          <p>The text remains here. Retry saving before starting another conversation.</p>
          <button
            type="button"
            disabled={session.historyBusy}
            onClick={() => void session.retrySave()}
          >
            {session.historyBusy ? 'Saving…' : 'Retry save'}
          </button>
          <button
            type="button"
            disabled={session.historyBusy}
            onClick={() => setDiscardUnsaved(true)}
          >
            Restore saved copy
          </button>
          {discardUnsaved && (
            <div>
              <p>Discard unsaved changes and restore the last saved text?</p>
              <button
                type="button"
                disabled={session.historyBusy}
                onClick={() => {
                  void session.restoreSaved();
                  setDiscardUnsaved(false);
                }}
              >
                Discard changes and restore
              </button>
              <button type="button" onClick={() => setDiscardUnsaved(false)}>
                Keep unsaved text
              </button>
            </div>
          )}
        </section>
      )}
      <AssistantComposer
        question={question}
        onQuestion={updateQuestion}
        configuration={session.configuration}
        desktop={desktop}
        pending={session.pending}
        locked={session.historyBusy || session.unsaved || !historyInput?.fits}
        context={prepared.context}
        error={session.error || uiError || prepared.error}
        onModel={(value) => void selectModel(value)}
        onRefreshModels={() => void refreshModels()}
        modelBusy={modelBusy}
        onSend={() => void submit()}
        onStop={() => void session.stop()}
        onConnect={() => setSettingsOpen(true)}
        omittedTurns={historyInput?.omittedTurns ?? 0}
        focusInput={!historyOpen}
      />
      {settingsOpen && (
        <AssistantSettingsPanel
          configuration={session.configuration}
          onClose={() => setSettingsOpen(false)}
          onSaved={session.configured}
        />
      )}
      {integrationsOpen && (
        <div className="modal-backdrop">
          <section
            className="modal assistant-integrations"
            role="dialog"
            aria-modal="true"
            aria-label="AI integrations"
          >
            <header>
              <h2>AI integrations</h2>
              <button
                type="button"
                aria-label="Close integrations"
                onClick={() => setIntegrationsOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            {mcpPanel}
          </section>
        </div>
      )}
    </aside>
  );
}
