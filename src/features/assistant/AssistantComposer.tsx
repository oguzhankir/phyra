import { useEffect, useId, useRef } from 'react';
import { ArrowUp, RefreshCw, Square } from 'lucide-react';
import type {
  AssistantConfiguration,
  AssistantContext,
  AssistantSettings,
} from '../../domain/assistant/types';
import Select from '../../shared/ui/Select';
import { ProviderLogo } from './providers';
import { chatModelChoices, chatModelKey } from './chatModels';

export default function AssistantComposer({
  question,
  onQuestion,
  configuration,
  desktop,
  pending,
  locked,
  context,
  error,
  onModel,
  onRefreshModels,
  modelBusy,
  onSend,
  onStop,
  onConnect,
  omittedTurns,
  focusInput,
}: {
  question: string;
  onQuestion: (value: string) => void;
  configuration: AssistantConfiguration | null;
  desktop: boolean;
  pending: boolean;
  locked: boolean;
  context: AssistantContext | null;
  error: string | null;
  onModel: (settings: AssistantSettings) => void;
  onRefreshModels: () => void;
  modelBusy: boolean;
  onSend: () => void;
  onStop: () => void;
  onConnect: () => void;
  omittedTurns: number;
  focusInput: boolean;
}) {
  const id = useId();
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (desktop && focusInput) composer.current?.focus();
  }, [desktop, focusInput]);
  useEffect(() => {
    if (
      focusInput &&
      (document.activeElement?.closest('.assistant-empty, .assistant-send') ||
        document.activeElement === document.body)
    )
      composer.current?.focus();
    const input = composer.current;
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(180, Math.max(62, input.scrollHeight))}px`;
    }
  }, [question]);
  const settings = configuration?.settings;
  const connected = !!settings?.model && (settings.local || !!configuration?.credentialPresent);
  const choices = chatModelChoices(configuration);
  return (
    <form
      className="assistant-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="assistant-input-box">
        <label className="sr-only" htmlFor={id}>
          Message the assistant
        </label>
        <textarea
          id={id}
          ref={composer}
          value={question}
          maxLength={16000}
          placeholder={connected ? 'Ask about your geometry or analysis…' : 'Ask a question…'}
          rows={3}
          disabled={!desktop}
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
              <Select
                aria-label="Chat model"
                compact
                searchable
                value={chatModelKey(settings)}
                options={choices.map((choice) => ({
                  ...choice,
                  icon: <ProviderLogo provider={choice.settings.provider} />,
                }))}
                placeholder={settings.model}
                disabled={pending || modelBusy || !desktop}
                onChange={(value) => {
                  const choice = choices.find((item) => item.value === value);
                  if (choice) onModel(choice.settings);
                }}
              />
              <button
                type="button"
                className="assistant-model-refresh"
                aria-label="Refresh available models"
                title="Refresh available models"
                disabled={pending || modelBusy || !desktop}
                onClick={onRefreshModels}
              >
                <RefreshCw
                  size={13}
                  className={modelBusy ? 'assistant-connection-spinner' : undefined}
                />
              </button>
            </div>
          ) : (
            <button
              className="assistant-connect-link"
              type="button"
              onClick={onConnect}
              disabled={!desktop}
            >
              Connect a provider
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
              title="Send message"
              disabled={!desktop || !question.trim() || !context || locked || modelBusy}
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
      {!desktop && (
        <p className="assistant-composer-notice">
          AI connections are available in the desktop app.
        </p>
      )}
      {omittedTurns > 0 && (
        <p className="assistant-composer-notice">
          {omittedTurns} older {omittedTurns === 1 ? 'turn is' : 'turns are'} outside this model’s
          message window.
        </p>
      )}
    </form>
  );
}
