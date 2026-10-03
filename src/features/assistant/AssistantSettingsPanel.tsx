import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { assistantModelChoices, FEATURED_MODELS } from '../../domain/assistant/models';
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
} from '../../platform/desktop/assistant';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { ProviderLogo, providerNames } from './providers';
import { connectAssistantProvider, connectionIsActive } from './connection';
import './AssistantSettingsPanel.css';

function sharesCredential(left: AssistantSettings, right: AssistantSettings): boolean {
  if (left.provider !== right.provider || left.local || right.local) return false;
  try {
    return new URL(left.endpoint).origin === new URL(right.endpoint).origin;
  } catch {
    return false;
  }
}
function initialSettings(configuration: AssistantConfiguration | null): AssistantSettings {
  const settings = configuration?.settings ?? ASSISTANT_DEFAULTS.gemini;
  return { ...settings, model: settings.model || FEATURED_MODELS[settings.provider][0]?.id || '' };
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
  const [settings, setSettings] = useState(() => initialSettings(configuration));
  const [credentialPresent, setCredentialPresent] = useState(
    configuration?.credentialPresent ?? false,
  );
  const [credential, setCredential] = useState('');
  const [replaceKey, setReplaceKey] = useState(false);
  const [models, setModels] = useState<AssistantModel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{
    settings: AssistantSettings;
    connection: boolean;
  } | null>(null);
  const credentialLookupVersion = useRef(0);
  useEffect(
    () => () => {
      credentialLookupVersion.current += 1;
    },
    [],
  );
  const custom = settings.provider === 'compatible' || settings.provider === 'ollama';
  const choices = assistantModelChoices(settings.provider, models, settings.model);
  const featured = choices.filter((model) => model.featured);
  const additional = choices.filter((model) => !model.featured);
  const active = connectionIsActive(configuration, settings);
  const selectedCredentialIsActive = Boolean(
    configuration?.settings.model &&
    (sharesCredential(configuration.settings, settings) ||
      (configuration.settings.local &&
        settings.local &&
        configuration.settings.provider === settings.provider &&
        configuration.settings.endpoint === settings.endpoint)),
  );
  const canConnect = Boolean(
    settings.endpoint.trim() && (settings.local || credentialPresent || credential.trim()),
  );
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

  async function selectProvider(value: AssistantProvider) {
    credentialLookupVersion.current += 1;
    const selected = initialSettings(
      configuration?.settings.provider === value
        ? configuration
        : { settings: ASSISTANT_DEFAULTS[value], credentialPresent: false },
    );
    setSettings(selected);
    setModels(null);
    setCredential('');
    setReplaceKey(false);
    setCredentialPresent(false);
    setError(null);
    setNotice(null);
    setRemoving(null);
    setBusy(true);
    try {
      if (!selected.local) setCredentialPresent(await getAssistantCredentialStatus(selected));
    } catch (failure) {
      if (selected.endpoint) fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function inspectEndpoint() {
    if (settings.local || !settings.endpoint.trim()) return;
    const lookupVersion = ++credentialLookupVersion.current;
    try {
      const present = await getAssistantCredentialStatus(settings);
      if (lookupVersion !== credentialLookupVersion.current) return;
      setCredentialPresent(present);
      setError(null);
    } catch (failure) {
      if (lookupVersion !== credentialLookupVersion.current) return;
      setCredentialPresent(false);
      fail(failure);
    }
  }

  async function discover() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const available = await listAssistantModels(settings);
      setModels(available);
      if (!assistantModelChoices(settings.provider, available).some((choice) => choice.available))
        setError(
          'No text models were reported by this connection. Check your endpoint or provider access.',
        );
      else setNotice('Available models refreshed.');
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    credentialLookupVersion.current += 1;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await connectAssistantProvider({
        settings,
        configuration,
        credential,
        models,
        onCredentialStored: () => {
          setCredentialPresent(true);
          setReplaceKey(false);
        },
        onModelsReported: setModels,
      });
      if (outcome.type === 'choose-model') {
        setModels(outcome.models);
        setNotice('Choose an available model to finish connecting.');
        return;
      }
      const value = outcome.configuration;
      onSaved(value.settings, value.credentialPresent);
      onClose();
    } catch (failure) {
      fail(failure);
    } finally {
      setCredential('');
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!removing) return;
    credentialLookupVersion.current += 1;
    setBusy(true);
    setError(null);
    try {
      if (removing.connection) {
        const value = await disconnectAssistant(removing.settings);
        onSaved(value.settings, value.credentialPresent);
        onClose();
      } else {
        await deleteAssistantCredential(removing.settings);
        setCredentialPresent(false);
        setCredential('');
        setReplaceKey(false);
        setModels(null);
        setRemoving(null);
        setNotice('Saved key removed.');
      }
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop assistant-connections-backdrop">
      <section
        className="modal assistant-connections"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-connections-title"
      >
        <header className="assistant-connections-header">
          <div>
            <h2 id="assistant-connections-title">Models & connections</h2>
            <p>Choose a provider. Bring your own key.</p>
          </div>
          <button
            type="button"
            className="assistant-connections-close"
            disabled={busy}
            aria-label="Close assistant connections"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="assistant-connections-layout">
          <nav className="assistant-connections-providers" aria-label="AI providers">
            <span className="assistant-connections-section-label">Providers</span>
            {(Object.keys(providerNames) as AssistantProvider[]).map((id) => (
              <button
                type="button"
                key={id}
                disabled={busy}
                aria-pressed={settings.provider === id}
                onClick={() => void selectProvider(id)}
              >
                <ProviderLogo provider={id} />
                <span>{providerNames[id]}</span>
                {configuration?.settings.model &&
                configuration.settings.provider === id &&
                (configuration.settings.local || configuration.credentialPresent) ? (
                  <span className="assistant-connection-dot" aria-label="Current connection" />
                ) : (
                  <ChevronRight size={13} />
                )}
              </button>
            ))}
            <div className="assistant-connections-security">
              <ShieldCheck size={15} />
              <span>Keys stay in your OS credential store.</span>
            </div>
          </nav>
          <div className="assistant-connections-content">
            <div className="assistant-connection-heading">
              <ProviderLogo provider={settings.provider} />
              <h3>{providerNames[settings.provider]}</h3>
              {active && (
                <span className="assistant-connection-badge">
                  <Check size={12} />
                  Connected
                </span>
              )}
            </div>
            {custom && (
              <label className="assistant-connection-field">
                Endpoint
                <input
                  aria-label="Assistant API endpoint"
                  value={settings.endpoint}
                  disabled={busy}
                  placeholder={
                    settings.provider === 'ollama'
                      ? 'http://127.0.0.1:11434/v1'
                      : 'https://your-provider.example/v1'
                  }
                  onChange={(event) => {
                    credentialLookupVersion.current += 1;
                    const endpoint = event.target.value;
                    let local = false;
                    try {
                      local = ['localhost', '127.0.0.1', '[::1]'].includes(
                        new URL(endpoint).hostname,
                      );
                    } catch {
                      /* Native validation explains an incomplete URL. */
                    }
                    setSettings({ ...settings, endpoint, local, model: '' });
                    setCredential('');
                    setCredentialPresent(
                      credentialPresent &&
                        sharesCredential(settings, { ...settings, endpoint, local }),
                    );
                    setModels(null);
                    setNotice(null);
                    setError(null);
                  }}
                  onBlur={() => void inspectEndpoint()}
                />
              </label>
            )}
            {settings.local ? (
              <p className="assistant-connection-local">
                Connect to models running on this device. No API key is needed.
              </p>
            ) : credentialPresent && !replaceKey ? (
              <div className="assistant-connection-saved-key">
                <KeyRound size={15} />
                <span>API key saved securely</span>
                <button type="button" disabled={busy} onClick={() => setReplaceKey(true)}>
                  Replace key
                </button>
              </div>
            ) : (
              <label className="assistant-connection-field">
                API key
                <input
                  type="password"
                  aria-label="Assistant API key"
                  value={credential}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your API key"
                  onChange={(event) => {
                    setCredential(event.target.value);
                    setError(null);
                  }}
                />
                <small>Saved on this device until you disconnect.</small>
              </label>
            )}
            <div className="assistant-connection-model-heading">
              <h4>Model</h4>
              <button
                type="button"
                className="assistant-connection-refresh"
                aria-label="Refresh available models"
                title="Refresh available models"
                disabled={busy || (!settings.local && !credentialPresent)}
                onClick={() => void discover()}
              >
                <RefreshCw size={13} />
                Refresh
              </button>
            </div>
            {featured.length > 0 && (
              <div
                className="assistant-connection-models"
                role="group"
                aria-label="Featured assistant models"
              >
                {featured.map((model) => (
                  <button
                    type="button"
                    className="assistant-connection-model"
                    key={model.id}
                    aria-pressed={settings.model === model.id}
                    disabled={busy || model.available === false}
                    title={model.id}
                    onClick={() => {
                      setSettings({ ...settings, model: model.id });
                      setNotice(null);
                    }}
                  >
                    <span className="assistant-connection-model-title">
                      <strong>{model.name}</strong>
                      <span>{model.tag}</span>
                    </span>
                    <small>
                      {model.available === false
                        ? 'Not available on this connection'
                        : model.detail}
                    </small>
                    <span className="assistant-connection-model-check" aria-hidden="true">
                      {settings.model === model.id && <Check size={14} />}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {additional.length > 0 && (
              <label className="assistant-connection-field assistant-connection-more">
                {featured.length ? 'More models' : 'Available models'}
                <select
                  aria-label="Assistant model"
                  value={
                    additional.some((model) => model.id === settings.model) ? settings.model : ''
                  }
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value) {
                      setSettings({ ...settings, model: event.target.value });
                      setNotice(null);
                    }
                  }}
                >
                  <option value="">Choose a model…</option>
                  {additional.map((model) => (
                    <option key={model.id} value={model.id} disabled={model.available === false}>
                      {model.name}
                      {model.available === false ? ' · Not available' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {featured.length === 0 && additional.length === 0 && (
              <div className="assistant-connection-model-empty">
                <RefreshCw size={18} />
                <p>Load the models available from your endpoint.</p>
                <small>
                  {settings.local
                    ? 'Start your local model server first.'
                    : 'Enter an endpoint and key, then load models.'}
                </small>
              </div>
            )}
            {notice && (
              <p className="assistant-connection-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="assistant-connection-error" role="alert">
                {error}
              </p>
            )}
            {removing && (
              <section
                className="assistant-connection-removal"
                aria-label="Confirm provider disconnection"
              >
                <strong>
                  {removing.connection
                    ? `Disconnect ${providerNames[removing.settings.provider]}?`
                    : 'Remove saved key?'}
                </strong>
                <p>
                  {removing.settings.local
                    ? 'The local connection will be removed.'
                    : 'The saved key will be removed from this device. It is not revoked at the provider.'}{' '}
                  Your conversations and projects will be kept.
                </p>
                <div>
                  <button type="button" disabled={busy} onClick={() => setRemoving(null)}>
                    Cancel
                  </button>
                  <button type="button" disabled={busy} onClick={() => void confirmRemoval()}>
                    {busy ? 'Disconnecting…' : removing.connection ? 'Disconnect' : 'Remove key'}
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
        <footer className="assistant-connections-footer">
          <div>
            {configuration?.settings.model && selectedCredentialIsActive ? (
              <button
                type="button"
                className="assistant-connection-disconnect"
                disabled={busy}
                onClick={() =>
                  setRemoving({ settings: { ...configuration.settings }, connection: true })
                }
              >
                Disconnect {providerNames[configuration.settings.provider]}
              </button>
            ) : (
              <small>Connection stays saved when you close Phyra.</small>
            )}
            {credentialPresent && !selectedCredentialIsActive && !settings.local && (
              <button
                type="button"
                className="assistant-connection-disconnect"
                disabled={busy}
                onClick={() => setRemoving({ settings: { ...settings }, connection: false })}
              >
                Remove saved key
              </button>
            )}
          </div>
          <button
            type="button"
            className="primary assistant-connection-submit"
            disabled={busy || !canConnect}
            onClick={() => void connect()}
          >
            {busy ? (
              <>
                <LoaderCircle className="assistant-connection-spinner" size={15} />
                Connecting…
              </>
            ) : (
              <>
                {!settings.model ? 'Load models' : active ? 'Use model' : 'Connect'}
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}
