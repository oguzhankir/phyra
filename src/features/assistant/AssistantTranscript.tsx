import { useEffect, useRef } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import type { AssistantConversation } from '../../domain/assistant/types';
import AcademicMarkdown from '../../shared/FormattedText';
import { openAssistantReference } from '../../platform/desktop/assistant';
import type { AssistantStudyContext } from './context';

/** Set only the owned transcript viewport; ancestor panels must not scroll. */
export function scrollAssistantTranscript(
  viewport: Pick<HTMLDivElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  empty: boolean,
) {
  viewport.scrollTop = empty ? 0 : Math.max(0, viewport.scrollHeight - viewport.clientHeight);
}

export default function AssistantTranscript({
  conversation,
  pending,
  study,
  desktop,
  onSource,
  onPrompt,
  onError,
}: {
  conversation: AssistantConversation;
  pending: boolean;
  study: AssistantStudyContext | null;
  desktop: boolean;
  onSource: (id: string) => void;
  onPrompt: (text: string, study: boolean) => void;
  onError: (message: string) => void;
}) {
  const session = { conversation, pending };
  const viewport = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const lastScroll = useRef(0);
  const wasEmpty = useRef(!conversation.messages.length);
  useEffect(() => {
    followOutput.current = true;
    lastScroll.current = 0;
    wasEmpty.current = true;
    if (viewport.current) scrollAssistantTranscript(viewport.current, true);
  }, [conversation.id]);
  useEffect(() => {
    const current = viewport.current;
    if (!current) return;
    if (!conversation.messages.length) {
      scrollAssistantTranscript(current, true);
      wasEmpty.current = true;
      return;
    }
    if (wasEmpty.current) followOutput.current = true;
    wasEmpty.current = false;
    const now = Date.now();
    if (followOutput.current && (!pending || now - lastScroll.current > 160)) {
      scrollAssistantTranscript(current, false);
      lastScroll.current = now;
    }
  }, [conversation.id, conversation.messages, pending]);
  const setUiError = onError;
  return (
    <div
      ref={viewport}
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
          <h3>{study ? 'Understand your study' : 'Engineering help'}</h3>
          <p>
            Ask about the formulation, preparation or current result. Replies cite the offline help
            and the study snapshot you attach.
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
                  onPrompt(prompt, !!study);
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
    </div>
  );
}
