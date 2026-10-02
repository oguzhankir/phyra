import { useState } from 'react';
import { Check, KeyRound, X } from 'lucide-react';
import {
  ASSISTANT_DEFAULTS,
  type AssistantConfiguration,
  type AssistantModel,
  type AssistantProvider,
  type AssistantSettings,
} from '../../domain/assistant/types';
import {
  deleteAssistantCredential,
  disconnectAssistant,
  getAssistantCredentialStatus,
  listAssistantModels,
  saveAssistantSettings,
  storeAssistantCredential,
} from '../../platform/desktop/assistant';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { ProviderLogo, providerNames } from './providers';

function sharesCredential(left: AssistantSettings, right: AssistantSettings): boolean {
  if (left.provider !== right.provider || left.local || right.local) return false;
  try {
    return new URL(left.endpoint).origin === new URL(right.endpoint).origin;
  } catch {
    return false;
  }
}

export default function AssistantSettingsPanel({
  configuration,
  onClose,
  onSaved,
}: {
  configuration: AssistantConfiguration | null;
  onClose: () => void;
  onSaved: (settings: AssistantSettings, credentialPresent: boolean) => void;
}) {
  const [settings, setSettings] = useState(
    () => configuration?.settings ?? ASSISTANT_DEFAULTS.gemini,
  );
  const [credentialPresent, setCredentialPresent] = useState(
    configuration?.credentialPresent ?? false,
  );
  const [credential, setCredential] = useState('');
  const [models, setModels] = useState<AssistantModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<AssistantSettings | null>(null);
  const custom = settings.provider === 'compatible' || settings.provider === 'ollama';
  useModalFocus(true, () => {
    if (!busy) onClose();
  });
  const fail = (failure: unknown) =>
    setError(
      typeof failure === 'string'
        ? failure
        : failure instanceof Error
          ? failure.message
          : 'The connection could not be configured.',
    );
  async function provider(value: AssistantProvider) {
    const selected =
      configuration?.settings.provider === value
        ? { ...configuration.settings }
        : { ...ASSISTANT_DEFAULTS[value] };
    setSettings(selected);
    setModels([]);
    setCredential('');
    setCredentialPresent(false);
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setCredentialPresent(await getAssistantCredentialStatus(selected));
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }
  async function saveKey() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await storeAssistantCredential(settings, credential.trim());
      setCredentialPresent(true);
      setNotice('API key stored in the operating system credential store.');
    } catch (failure) {
      fail(failure);
    } finally {
      setCredential('');
      setBusy(false);
    }
  }
  async function discover() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const available = await listAssistantModels(settings);
      setModels(available);
      setNotice(`${available.length} model(s) reported by this endpoint. Choose a model below.`);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!settings.local && credential.trim())
        await storeAssistantCredential(settings, credential.trim());
      const value = await saveAssistantSettings(settings);
      onSaved(value.settings, value.credentialPresent);
      onClose();
    } catch (failure) {
      fail(failure);
    } finally {
      setCredential('');
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal assistant-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-settings-title"
      >
        <header>
          <div>
            <h2 id="assistant-settings-title">Assistant settings</h2>
            <p>Your provider · your API key · local chat history</p>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-label="Close assistant settings"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="assistant-provider-options" role="group" aria-label="AI provider">
          {(Object.keys(providerNames) as AssistantProvider[]).map((id) => (
            <button
              type="button"
              key={id}
              disabled={busy}
              aria-pressed={settings.provider === id}
              onClick={() => void provider(id)}
            >
              <ProviderLogo provider={id} />
              <span>{providerNames[id]}</span>
              {settings.provider === id && <Check size={14} />}
            </button>
          ))}
        </div>
        <label>
          API endpoint
          <input
            aria-label="Assistant API endpoint"
            value={settings.endpoint}
            disabled={!custom || busy}
            placeholder="https://your-provider.example/v1"
            onChange={(event) => {
              const endpoint = event.target.value;
              let local = false;
              try {
                local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
              } catch {
                /* Native validation explains an incomplete URL. */
              }
              setSettings({ ...settings, endpoint, local });
              setCredential('');
              setCredentialPresent(false);
              setModels([]);
              setNotice(null);
            }}
          />
        </label>
        <div className="assistant-key-section">
          <div className="assistant-key-state">
            <KeyRound size={15} />
            <span>
              {credentialPresent
                ? 'A key is stored for this provider and endpoint'
                : settings.local
                  ? 'Local endpoint · key optional'
                  : 'Store your key to connect'}
            </span>
          </div>
          <p className="assistant-settings-note">
            Saved securely on this device until you remove the key or disconnect the provider.
            Closing Phyra does not disconnect it.
          </p>
          <label>
            API key
            <input
              type="password"
              aria-label="Assistant API key"
              value={credential}
              disabled={busy || settings.local}
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter a key; it will not be shown again"
              onChange={(event) => setCredential(event.target.value)}
            />
          </label>
          <div className="assistant-setting-actions">
            <button
              type="button"
              disabled={busy || settings.local || !credential.trim()}
              onClick={() => void saveKey()}
            >
              Store key securely
            </button>
            <button type="button" disabled={busy} onClick={() => void discover()}>
              Discover models
            </button>
            {credentialPresent && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  if (configuration && sharesCredential(configuration.settings, settings)) {
                    setDisconnecting({ ...configuration.settings });
                    return;
                  }
                  setBusy(true);
                  try {
                    await deleteAssistantCredential(settings);
                    setCredentialPresent(false);
                    setNotice('Stored key removed.');
                  } catch (failure) {
                    fail(failure);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove saved key
              </button>
            )}
          </div>
        </div>
        <label>
          Model
          {models.length ? (
            <select
              aria-label="Assistant model"
              value={settings.model}
              disabled={busy}
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            >
              <option value="">Choose a model…</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Assistant model ID"
              value={settings.model}
              disabled={busy}
              placeholder="Discover models or enter an exact model ID"
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            />
          )}
        </label>
        <p className="assistant-settings-note">
          Text chat streams through the native app. No Phyra account is required. Remote providers
          receive only the conversation and context you choose to send. Provider charges apply; cost
          is unknown. Model discovery lists endpoint identifiers, not an assurance that every model
          supports text chat.
        </p>
        {notice && (
          <p className="assistant-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="assistant-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {configuration?.settings.model && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDisconnecting({ ...configuration.settings })}
            >
              Disconnect {providerNames[configuration.settings.provider]}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !settings.model.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Working…' : 'Save connection'}
          </button>
        </footer>
        {disconnecting && (
          <section aria-label="Confirm provider disconnection">
            <p>
              {disconnecting.local ? 'Disconnect ' : 'Remove the saved key and disconnect '}
              {providerNames[disconnecting.provider]}? Local conversations and projects will be
              kept.
              {!disconnecting.local && ' This does not revoke the key at the provider.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const value = await disconnectAssistant(disconnecting);
                  onSaved(value.settings, value.credentialPresent);
                  onClose();
                } catch (failure) {
                  fail(failure);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {disconnecting.local ? 'Disconnect' : 'Disconnect and remove saved key'}
            </button>
            <button type="button" disabled={busy} onClick={() => setDisconnecting(null)}>
              Keep connection
            </button>
          </section>
        )}
      </section>
    </div>
  );
}
