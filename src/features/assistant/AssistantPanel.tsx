import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  History,
  MessageSquarePlus,
  Send,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AssistantConfiguration,
  AssistantContext,
  AssistantConversation,
  AssistantConversationSummary,
  AssistantSettings,
} from '../../domain/assistant/types';
import { promptHistory } from '../../domain/assistant/prompt';
import AcademicMarkdown from '../../shared/FormattedText';
import { openAssistantReference } from '../../platform/desktop/assistant';
import { ASSISTANT_SYSTEM, assistantContext, type AssistantStudyContext } from './context';
import { ProviderLogo, providerNames } from './providers';
import AssistantSettingsPanel from './AssistantSettingsPanel';
import './AssistantPanel.css';

export interface AssistantViewModel {
  configuration: AssistantConfiguration | null;
  conversation: AssistantConversation;
  history: AssistantConversationSummary[];
  error: string | null;
  pending: boolean;
  historyBusy: boolean;
  configured: (settings: AssistantSettings, credentialPresent: boolean) => void;
  send: (question: string, context: AssistantContext, allowRemote: boolean) => Promise<boolean>;
  stop: () => Promise<void>;
  newConversation: () => void;
  openConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
}
export default function AssistantPanel({
  open,
  desktop,
  study,
  session,
  onClose,
  onSource,
  mcpPanel,
  onModalChange,
}: {
  open: boolean;
  desktop: boolean;
  study: AssistantStudyContext | null;
  session: AssistantViewModel;
  onClose: () => void;
  onSource: (id: string) => void;
  mcpPanel?: React.ReactNode;
  onModalChange?: (open: boolean) => void;
}) {
  const [question, setQuestion] = useState('');
  const [includeStudy, setIncludeStudy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  useEffect(() => {
    onModalChange?.(settingsOpen);
    return () => onModalChange?.(false);
  }, [settingsOpen, onModalChange]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastScroll = useRef(0);
  const followOutput = useRef(true);
  const conversationId = session.conversation.id;
  useEffect(() => {
    setQuestion('');
    setIncludeStudy(false);
    setConsent(false);
    setUiError(null);
    setDeleteId(null);
    followOutput.current = true;
  }, [study?.documentId, conversationId]);
  useEffect(() => {
    setConsent(false);
  }, [session.configuration?.settings.provider, session.configuration?.settings.endpoint]);
  useEffect(() => {
    if (open) composer.current?.focus();
  }, [open]);
  useEffect(() => {
    const now = Date.now();
    if (
      open &&
      session.conversation.messages.length &&
      followOutput.current &&
      (!session.pending || now - lastScroll.current > 200)
    ) {
      bottom.current?.scrollIntoView({ block: 'nearest' });
      lastScroll.current = now;
    }
  }, [open, session.conversation.messages, session.pending]);
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
  const remote = !!settings && !settings.local;
  const connected = !!settings?.model;
  async function submit(text = question) {
    if (!text.trim() || session.pending || !prepared.context) return;
    if (remote && !consent) {
      setUiError(
        'Review the context and allow sending this conversation to the selected provider.',
      );
      return;
    }
    setUiError(null);
    followOutput.current = true;
    const context = assistantContext(text, study, includeStudy);
    setQuestion('');
    await session.send(text.trim(), context, !remote || consent);
  }
  if (!open) return null;
  return (
    <aside className="assistant-panel" aria-label="Academic assistant">
      <header className="assistant-header">
        <div>
          <strong>Assistant</strong>
          <small>{study ? study.project.name : 'Product help'} · Ctrl/⌘ J</small>
        </div>
        <button type="button" aria-label="Close assistant" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="assistant-toolbar">
        <button
          type="button"
          onClick={session.newConversation}
          disabled={session.pending || session.historyBusy}
          title="New conversation"
          aria-label="New assistant conversation"
        >
          <MessageSquarePlus size={17} />
        </button>
        <button
          type="button"
          aria-pressed={historyOpen}
          disabled={!desktop}
          onClick={() => setHistoryOpen(!historyOpen)}
          title="Local conversation history"
        >
          <History size={17} />
          History
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          disabled={!desktop || session.pending}
          title="Provider and model settings"
        >
          <Settings2 size={16} />
          Connection
        </button>
        <span className="assistant-provider-status">
          {settings && <ProviderLogo provider={settings.provider} />}
          <span>
            {settings ? providerNames[settings.provider] : 'Not connected'}
            <small>{settings?.model || 'Choose a model'}</small>
          </span>
        </span>
      </div>
      {historyOpen && (
        <section className="assistant-history" aria-label="Local assistant history">
          <p>Saved on this device · {study ? 'this project' : 'product help'}</p>
          {session.history.length ? (
            session.history.map((item) => (
              <div key={item.id}>
                <button
                  type="button"
                  disabled={session.pending || session.historyBusy}
                  aria-current={conversationId === item.id ? 'page' : undefined}
                  onClick={() => void session.openConversation(item.id)}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.messageCount} messages · {new Date(item.updatedAt).toLocaleString()}
                  </small>
                </button>
                <button
                  type="button"
                  disabled={session.pending || session.historyBusy}
                  aria-label={`Delete conversation ${item.title}`}
                  onClick={() => setDeleteId(item.id)}
                >
                  <Trash2 size={14} />
                </button>
                {deleteId === item.id && (
                  <div className="assistant-history-delete">
                    <span>Delete this local conversation?</span>
                    <button
                      type="button"
                      onClick={() => {
                        void session.removeConversation(item.id);
                        setDeleteId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => setDeleteId(null)}>
                      Keep
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p>No saved conversations.</p>
          )}
        </section>
      )}
      <div
        className="assistant-messages"
        onScroll={(event) => {
          const el = event.currentTarget;
          followOutput.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80;
        }}
        aria-label="Assistant conversation"
        aria-busy={session.pending}
      >
        {!session.conversation.messages.length && (
          <div className="assistant-empty">
            <BookOpen size={26} />
            <h3>Understand your study</h3>
            <p>
              Ask about the formulation, preparation or current result. Replies cite the offline
              help and the study snapshot you attach.
            </p>
            <div>
              {(study
                ? [
                    'What have I defined, and what is missing?',
                    'Explain the governing equations for this study.',
                    'How should I interpret the current result?',
                  ]
                : [
                    'How do I start a structural study?',
                    'Explain the elasticity formulation.',
                    'What can this version of Phyra do?',
                  ]
              ).map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  onClick={() => {
                    setQuestion(prompt);
                    if (study) {
                      setIncludeStudy(true);
                      setConsent(false);
                    }
                    composer.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <small>
              Read-only assistance. Project changes and analysis runs remain in the workbench.
            </small>
          </div>
        )}
        {session.conversation.messages.map((message) => (
          <article
            className={`assistant-message ${message.role}`}
            key={message.id}
            aria-label={message.role === 'user' ? 'Your message' : 'Assistant reply'}
          >
            <div className="assistant-message-heading">
              <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
              <small>
                {message.role === 'assistant' && message.model}
                {message.status !== 'complete' &&
                  ` · ${session.pending && message.id === session.conversation.messages.at(-1)?.id ? 'streaming' : message.status}`}
              </small>
            </div>
            {message.content ? (
              <AcademicMarkdown
                onSource={onSource}
                onExternal={
                  desktop
                    ? (url) => {
                        void openAssistantReference(url).catch(() =>
                          setUiError('This link cannot be opened here. Copy the displayed URL.'),
                        );
                      }
                    : undefined
                }
              >
                {message.content}
              </AcademicMarkdown>
            ) : (
              <span className="assistant-thinking">
                {session.pending && message.id === session.conversation.messages.at(-1)?.id
                  ? 'Connecting…'
                  : message.status === 'cancelled'
                    ? 'Stopped before any text arrived.'
                    : 'No response text.'}
              </span>
            )}
            {message.role === 'assistant' && message.context && (
              <details className="assistant-message-provenance">
                <summary>
                  Sources and snapshot <ChevronDown size={12} />
                </summary>
                <p>
                  {message.context.kind === 'study'
                    ? `Study ${message.context.studyId} · revision ${message.context.revision}`
                    : 'Product documentation only'}
                </p>
                <div>
                  {message.context.sourceIds.map((id) => (
                    <button type="button" key={id} onClick={() => onSource(id)}>
                      {id}
                    </button>
                  ))}
                </div>
                {message.usage && (
                  <p>
                    Tokens: {message.usage.inputTokens ?? 'unknown'} input ·{' '}
                    {message.usage.outputTokens ?? 'unknown'} output · cost unknown
                  </p>
                )}
                <pre>{message.context.text}</pre>
              </details>
            )}
          </article>
        ))}
        <div ref={bottom} />
      </div>
      {mcpPanel}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!desktop && (
          <p className="assistant-notice">
            Provider connections and secure key storage are available in the desktop app. Offline
            help remains available here.
          </p>
        )}
        <div className="assistant-context-choice">
          <label>
            <input
              type="checkbox"
              checked={includeStudy}
              disabled={!study || session.pending}
              onChange={(event) => {
                setIncludeStudy(event.target.checked);
                setConsent(false);
              }}
            />
            Attach active study and result summary
          </label>
          <small>
            {includeStudy && study
              ? `Revision ${study.project.revision} · SI · no files or field buffers`
              : 'Product documentation only'}
          </small>
        </div>
        <details className="assistant-context-preview">
          <summary>Review what will be sent</summary>
          <p>
            To: {settings?.endpoint || 'No endpoint selected'}. {historyInput?.includedTurns ?? 0}{' '}
            complete preceding turn(s) are included, along with your question and the context below.
            {!!historyInput?.omittedTurns &&
              ` ${historyInput.omittedTurns} older turn(s) are omitted to fit the request limits.`}
          </p>
          <pre>{prepared.context?.text ?? prepared.error}</pre>
        </details>
        {remote && (
          <label className="assistant-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={session.pending}
              onChange={(event) => setConsent(event.target.checked)}
            />
            Allow sending this conversation and selected context to{' '}
            {providerNames[settings!.provider]}
          </label>
        )}
        <label className="sr-only" htmlFor="assistant-question">
          Message the assistant
        </label>
        <textarea
          id="assistant-question"
          ref={composer}
          value={question}
          maxLength={16000}
          placeholder={
            connected
              ? 'Ask about the study or its formulation…'
              : 'Connect a provider to start chatting…'
          }
          rows={3}
          disabled={!desktop || session.pending}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {(session.error || uiError || prepared.error) && (
          <p className="assistant-error" role="alert">
            {session.error || uiError || prepared.error}
          </p>
        )}
        <div className="assistant-composer-actions">
          <small>Enter sends · Shift Enter adds a line</small>
          {session.pending ? (
            <button type="button" onClick={() => void session.stop()}>
              <Square size={14} />
              Stop
            </button>
          ) : connected ? (
            <button
              type="submit"
              className="primary"
              disabled={
                !desktop ||
                !question.trim() ||
                !prepared.context ||
                !historyInput?.fits ||
                session.historyBusy ||
                (remote && !consent)
              }
            >
              <Send size={14} />
              Send
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!desktop}
              onClick={() => setSettingsOpen(true)}
            >
              Connect provider
            </button>
          )}
        </div>
      </form>
      {settingsOpen && (
        <AssistantSettingsPanel
          configuration={session.configuration}
          onClose={() => setSettingsOpen(false)}
          onSaved={session.configured}
        />
      )}
    </aside>
  );
}
