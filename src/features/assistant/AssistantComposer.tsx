import { useEffect, useId, useRef } from 'react';
import { ArrowUp, BookOpen, ChevronDown, FileBox, Square } from 'lucide-react';
import type { AssistantConfiguration, AssistantContext } from '../../domain/assistant/types';
import { assistantModelChoices } from '../../domain/assistant/models';
import { ProviderLogo } from './providers';

export default function AssistantComposer({
  question,
  onQuestion,
  configuration,
  desktop,
  pending,
  locked,
  includeStudy,
  studyName,
  revision,
  context,
  error,
  onScope,
  onModel,
  modelBusy,
  onSend,
  onStop,
  onConnect,
  includedTurns,
  omittedTurns,
  priorStudy,
}: {
  question: string;
  onQuestion: (value: string) => void;
  configuration: AssistantConfiguration | null;
  desktop: boolean;
  pending: boolean;
  locked: boolean;
  includeStudy: boolean;
  studyName: string | null;
  revision: number | null;
  context: AssistantContext | null;
  error: string | null;
  onScope: (study: boolean) => void;
  onModel: (id: string) => void;
  modelBusy: boolean;
  onSend: () => void;
  onStop: () => void;
  onConnect: () => void;
  includedTurns: number;
  omittedTurns: number;
  priorStudy: boolean;
}) {
  const id = useId();
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (desktop) composer.current?.focus();
  }, [desktop]);
  useEffect(() => {
    if (question && document.activeElement?.closest('.assistant-empty')) composer.current?.focus();
  }, [question]);
  const settings = configuration?.settings;
  const connected = !!settings?.model && (settings.local || !!configuration?.credentialPresent);
  return (
    <form
      className="assistant-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="assistant-context-bar" role="group" aria-label="Message context">
        <button
          type="button"
          className="assistant-scope-chip"
          aria-pressed={!includeStudy}
          disabled={pending}
          onClick={() => onScope(false)}
        >
          <BookOpen size={13} />
          Help only
        </button>
        <button
          type="button"
          className="assistant-scope-chip"
          aria-pressed={includeStudy}
          title={
            studyName
              ? `Include ${studyName}, revision ${revision}`
              : 'Open a project to attach its study'
          }
          disabled={!studyName || pending}
          onClick={() => onScope(true)}
        >
          <FileBox size={13} />
          This study
        </button>
        <details className="assistant-context-preview">
          <summary title="Review the exact context">
            Context <ChevronDown size={12} />
          </summary>
          <div>
            <strong>
              {includeStudy ? `${studyName} · revision ${revision}` : 'Product documentation'}
            </strong>
            <p>
              {priorStudy &&
                'Earlier messages include study data. Start a new chat to exclude them. '}
              {includedTurns} preceding turn(s)
              {omittedTurns ? ` · ${omittedTurns} older turn(s) omitted` : ''}. No files or field
              buffers.
            </p>
            <pre>{context?.text ?? 'Context unavailable.'}</pre>
          </div>
        </details>
      </div>
      <div className="assistant-input-box">
        <label className="sr-only" htmlFor={id}>
          Message the assistant
        </label>
        <textarea
          id={id}
          ref={composer}
          value={question}
          maxLength={16000}
          placeholder={connected ? 'Ask about your study…' : 'Ask a question…'}
          rows={3}
          disabled={!desktop || pending}
          onChange={(event) => onQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="assistant-composer-actions">
          {connected && settings ? (
            <div className="assistant-model-picker">
              <ProviderLogo provider={settings.provider} />
              <select
                aria-label="Chat model"
                value={settings.model}
                disabled={pending || modelBusy || !desktop}
                onChange={(event) => onModel(event.target.value)}
              >
                {assistantModelChoices(settings.provider, null, settings.model).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              className="assistant-connect-link"
              type="button"
              onClick={onConnect}
              disabled={!desktop}
            >
              Connect a model
            </button>
          )}
          {pending ? (
            <button
              type="button"
              className="assistant-send"
              aria-label="Stop response"
              title="Stop response"
              onClick={onStop}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="assistant-send primary"
              aria-label="Send message"
              title="Send · Enter"
              disabled={
                !desktop || !connected || !question.trim() || !context || locked || modelBusy
              }
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      )}
      <div className="assistant-composer-footnote">
        <span>
          {!desktop
            ? 'Chat connections are available in the desktop app.'
            : includeStudy
              ? `${studyName} · revision ${revision}`
              : priorStudy
                ? 'Earlier study messages included'
                : 'No project attached'}
        </span>
        <span>Shift Enter for a new line</span>
      </div>
    </form>
  );
}
