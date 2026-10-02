import { useEffect, useMemo, useRef, useState } from 'react';
import { History, MessageCircle, Plug, Plus, Settings2, X } from 'lucide-react';
import type { AssistantContext } from '../../domain/assistant/types';
import { promptHistory } from '../../domain/assistant/prompt';
import { previouslyApproved, sharingIdentity, sharingScope } from '../../domain/assistant/sharing';
import { saveAssistantSettings } from '../../platform/desktop/assistant';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { ASSISTANT_SYSTEM, assistantContext, type AssistantStudyContext } from './context';
import { providerNames } from './providers';
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
  const [question, setQuestion] = useState('');
  const [includeStudy, setIncludeStudy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [discardUnsaved, setDiscardUnsaved] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [grant, setGrant] = useState<string | null>(null);
  const [approval, setApproval] = useState<{
    identity: string;
    question: string;
    context: AssistantContext;
    model: string;
    documentId: string | null;
  } | null>(null);
  const modalOpen = settingsOpen || integrationsOpen || !!approval;
  useEffect(() => {
    onModalChange?.(modalOpen);
    return () => onModalChange?.(false);
  }, [modalOpen, onModalChange]);
  useModalFocus(
    integrationsOpen || !!approval,
    () => {
      setIntegrationsOpen(false);
      setApproval(null);
    },
    approval ? 'share-context' : 'integrations',
  );
  useEffect(() => {
    setQuestion('');
    setIncludeStudy(false);
    setUiError(null);
    setApproval(null);
    setDiscardUnsaved(false);
  }, [study?.documentId, session.conversation.id]);
  useEffect(() => {
    if (
      draft &&
      draft.id !== consumedDraft.current &&
      draft.documentId === (study?.documentId ?? null)
    ) {
      consumedDraft.current = draft.id;
      setQuestion(draft.question);
      setIncludeStudy(draft.includeStudy && !!study);
      setApproval(null);
    }
  }, [draft, study?.documentId]);
  useEffect(() => {
    if (!open) {
      setApproval(null);
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
    await session.send(text.trim(), context, true, () => setQuestion(''));
  }
  async function submit() {
    if (!settings?.model || (!settings.local && !session.configuration?.credentialPresent)) {
      setSettingsOpen(true);
      return;
    }
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
    const scope = sharingScope(session.conversation, prepared.context);
    const identity = sharingIdentity(session.conversation, settings, scope);
    if (
      !settings.local &&
      grant !== identity &&
      !previouslyApproved(session.conversation, settings, scope)
    ) {
      setApproval({
        identity,
        question,
        context: prepared.context,
        model: settings.model,
        documentId: study?.documentId ?? null,
      });
      return;
    }
    await transmit(question, prepared.context);
  }
  async function selectModel(model: string) {
    if (!settings || session.pending || modelBusy || model === settings.model) return;
    setModelBusy(true);
    setUiError(null);
    try {
      const value = await saveAssistantSettings({ ...settings, model });
      session.configured(value.settings, value.credentialPresent);
    } catch (failure) {
      setUiError(typeof failure === 'string' ? failure : 'The model could not be changed.');
    } finally {
      setModelBusy(false);
    }
  }
  if (!open) return null;
  return (
    <aside className="assistant-panel" aria-label="Academic assistant">
      <header className="assistant-header">
        <div className="assistant-heading">
          <MessageCircle size={17} />
          <strong>Chat</strong>
        </div>
        <div className="assistant-header-actions">
          <button
            type="button"
            onClick={session.newConversation}
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
            aria-label="Models and providers"
            title="Models and providers"
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
          onPrompt={(text, attach) => {
            setQuestion(text);
            setIncludeStudy(attach);
          }}
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
        onQuestion={setQuestion}
        configuration={session.configuration}
        desktop={desktop}
        pending={session.pending}
        locked={session.historyBusy || session.unsaved || !historyInput?.fits}
        includeStudy={includeStudy}
        studyName={study?.project.name ?? null}
        revision={study?.project.revision ?? null}
        context={prepared.context}
        error={session.error || uiError || prepared.error}
        onScope={setIncludeStudy}
        onModel={(model) => void selectModel(model)}
        modelBusy={modelBusy}
        onSend={() => void submit()}
        onStop={() => void session.stop()}
        onConnect={() => setSettingsOpen(true)}
        includedTurns={historyInput?.includedTurns ?? 0}
        omittedTurns={historyInput?.omittedTurns ?? 0}
        priorStudy={session.conversation.messages.some(
          (message) => message.context?.kind === 'study',
        )}
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
              <h2>Integrations</h2>
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
      {approval && settings && (
        <div className="modal-backdrop">
          <section
            className="modal assistant-sharing"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm conversation sharing"
          >
            <h2>Chat with {providerNames[settings.provider]}</h2>
            <p>
              Your question, preceding messages and{' '}
              {sharingScope(session.conversation, approval.context) === 'study'
                ? 'study context'
                : 'product documentation'}{' '}
              will be sent to this provider.
            </p>
            <p>
              This permission applies to this conversation. Sharing study data or changing the
              provider requires approval again.
            </p>
            <div className="assistant-sharing-destination">
              <strong>{providerNames[settings.provider]}</strong>
              <span>{settings.endpoint}</span>
            </div>
            <details className="assistant-context-preview">
              <summary>Review context</summary>
              <pre>{approval.context.text}</pre>
            </details>
            <div className="modal-actions">
              <button type="button" onClick={() => setApproval(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const scope = sharingScope(session.conversation, approval.context);
                  if (
                    approval.identity !== sharingIdentity(session.conversation, settings, scope) ||
                    approval.model !== settings.model ||
                    approval.documentId !== (study?.documentId ?? null)
                  ) {
                    setApproval(null);
                    setUiError('The chat changed. Review and send your question again.');
                    return;
                  }
                  setGrant(approval.identity);
                  setApproval(null);
                  void transmit(approval.question, approval.context);
                }}
              >
                Start chat
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
