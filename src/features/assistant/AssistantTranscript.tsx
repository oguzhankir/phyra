import { useEffect, useRef } from 'react';
import { Copy, Sparkles } from 'lucide-react';
import { modelLabel } from '../../domain/assistant/models';
import { helpArticles } from '../help/content';
import { ProviderLogo } from './providers';
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
  const cadContext =
    !!study?.cad && (!study.project.study || ['cad', 'geometry'].includes(study.section));
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
          <span className="assistant-welcome-mark">
            <Sparkles size={27} />
          </span>
          <h3>
            {cadContext
              ? 'Let’s build your geometry'
              : study
                ? 'Let’s explore your study'
                : 'Your engineering assistant'}
          </h3>
          <p>
            {cadContext
              ? 'Plan a sketch, review its constraints and find the next supported analysis step.'
              : study
                ? 'Ask about your setup, the governing equations or what your results mean.'
                : 'Explore the mechanics, plan a study or find your way around Phyra.'}
          </p>
          <div>
            {(cadContext
              ? [
                  'How do I draw a constrained sketch and turn it into a solid?',
                  'What does my selected CAD output support for analysis?',
                  'Explain my sketch degrees of freedom and constraints to review.',
                ]
              : study
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
            <strong>
              {message.role === 'assistant' &&
                (message.provider ? (
                  <ProviderLogo provider={message.provider} />
                ) : (
                  <Sparkles size={13} />
                ))}
              {message.role === 'user' ? 'You' : 'Assistant'}
            </strong>
            <small>
              {message.role === 'assistant' &&
                message.model &&
                (message.provider ? modelLabel(message.provider, message.model) : message.model)}
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
          {message.role === 'assistant' && message.content && (
            <footer className="assistant-message-footer">
              <button
                type="button"
                aria-label="Copy assistant reply"
                title="Copy reply"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(message.content)
                    .catch(() =>
                      setUiError('The reply could not be copied. Try selecting its text.'),
                    );
                }}
              >
                <Copy size={13} />
              </button>
              <div className="assistant-message-sources" aria-label="Reply sources">
                {message.context?.sourceIds
                  .filter((id) => message.content.includes(`#help:${id})`))
                  .map((id) => (
                    <button type="button" key={id} onClick={() => onSource(id)}>
                      {helpArticles.find((article) => article.id === id)?.title ?? id}
                    </button>
                  ))}
              </div>
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}
