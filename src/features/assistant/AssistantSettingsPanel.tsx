import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react';
import {
  ASSISTANT_DEFAULTS,
  type AssistantConfiguration,
  type AssistantProvider,
  type AssistantSettings,
} from '../../domain/assistant/types';
import {
  disconnectAssistant,
  getAssistantCredentialStatus,
  getAssistantSettings,
  listAssistantModels,
} from '../../platform/desktop/assistant';
import { assistantConnectionKey, assistantConnectionReady } from '../../domain/assistant/models';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { ProviderLogo, providerNames } from './providers';
import { connectAssistantProvider } from './connection';
import './AssistantSettingsPanel.css';

const ready = assistantConnectionReady;

export default function AssistantSettingsPanel({
  configuration,
  onClose,
  onSaved,
}: {
  configuration: AssistantConfiguration | null;
  onClose: () => void;
  onSaved: (configuration: AssistantConfiguration) => void;
}) {
  const [saved, setSaved] = useState(configuration);
  const [settings, setSettings] = useState<AssistantSettings>(() => ({
    ...(configuration?.settings ?? ASSISTANT_DEFAULTS.gemini),
  }));
  const [credentialPresent, setCredentialPresent] = useState(
    configuration?.credentialPresent ?? false,
  );
  const [credential, setCredential] = useState('');
  const [replaceKey, setReplaceKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const lookupVersion = useRef(0);
  const connections = saved?.connections ?? [];
  const connection = connections.find(
    (item) => assistantConnectionKey(item.settings) === assistantConnectionKey(settings),
  );
  const connected = !!connection && ready(connection);
  const sharedKey =
    !!connection &&
    !connection.settings.local &&
    connections.some(
      (item) =>
        item !== connection &&
        !item.settings.local &&
        item.settings.provider === connection.settings.provider &&
        new URL(item.settings.endpoint).origin === new URL(connection.settings.endpoint).origin,
    );
  const custom = settings.provider === 'compatible' || settings.provider === 'ollama';
  useEffect(() => setSaved(configuration), [configuration]);
  useEffect(
    () => () => {
      lookupVersion.current += 1;
    },
    [],
  );
  useModalFocus(
    true,
    () => {
      if (busy) return;
      if (removing) setRemoving(false);
      else onClose();
    },
    removing ? 'disconnect-provider' : 'provider-connections',
  );
  const fail = (failure: unknown) =>
    setError(
      typeof failure === 'string'
        ? failure
        : failure instanceof Error
          ? failure.message
          : 'The connection could not be configured. Try again.',
    );
  async function inspect(selected: AssistantSettings) {
    const version = ++lookupVersion.current;
    if (selected.local || !selected.endpoint.trim()) {
      setCredentialPresent(false);
      return;
    }
    try {
      const present = await getAssistantCredentialStatus(selected);
      if (version === lookupVersion.current) setCredentialPresent(present);
    } catch (failure) {
      if (version === lookupVersion.current) fail(failure);
    }
  }
  function selectProvider(provider: AssistantProvider, chosen?: AssistantSettings) {
    lookupVersion.current += 1;
    const existing = connections.find((item) => item.settings.provider === provider);
    const selected = { ...(chosen ?? existing?.settings ?? ASSISTANT_DEFAULTS[provider]) };
    setSettings(selected);
    setCredential('');
    setReplaceKey(false);
    setShowKey(false);
    setError(null);
    setNotice(null);
    setRemoving(false);
    setCredentialPresent(
      existing?.settings.endpoint === selected.endpoint && !!existing?.credentialPresent,
    );
    void inspect(selected);
  }
  async function connect() {
    if (busy) return;
    lookupVersion.current += 1;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await connectAssistantProvider({
        settings,
        configuration: saved,
        credential,
        models: connected && !credential.trim() ? await listAssistantModels(settings) : null,
        onCredentialStored: () => setCredentialPresent(true),
      });
      const value = outcome.configuration;
      setSaved(value);
      onSaved(value);
      const updated = value.connections.find(
        (item) =>
          item.settings.provider === settings.provider &&
          item.settings.endpoint === settings.endpoint,
      );
      if (updated) {
        setSettings(updated.settings);
        setCredentialPresent(updated.credentialPresent);
      }
      setReplaceKey(false);
      setNotice(
        `${providerNames[settings.provider]} is ready. Choose its models in the assistant.`,
      );
    } catch (failure) {
      fail(failure);
      void inspect(settings);
      try {
        const value = await getAssistantSettings();
        setSaved(value);
        onSaved(value);
      } catch {
        /* Keep the original connection error visible. */
      }
    } finally {
      setCredential('');
      setShowKey(false);
      setBusy(false);
    }
  }
  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await disconnectAssistant(settings);
      setSaved(value);
      onSaved(value);
      setCredentialPresent(false);
      setCredential('');
      setReplaceKey(false);
      setRemoving(false);
      setNotice(`${providerNames[settings.provider]} disconnected.`);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }
  const canConnect =
    !!settings.endpoint.trim() &&
    (settings.local || !!credential.trim() || (credentialPresent && !replaceKey));
  return (
    <div className="modal-backdrop assistant-connections-backdrop">
      <section
        className="modal assistant-connections"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-connections-title"
        aria-busy={busy}
      >
        <header className="assistant-connections-header">
          <div>
            <h2 id="assistant-connections-title">AI connections</h2>
            <p>Connect your providers. Switch models from the assistant.</p>
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
            {(Object.keys(providerNames) as AssistantProvider[]).map((provider) => {
              const count = connections.filter(
                (item) => item.settings.provider === provider && ready(item),
              ).length;
              return (
                <button
                  type="button"
                  key={provider}
                  disabled={busy}
                  aria-pressed={settings.provider === provider}
                  onClick={() => selectProvider(provider)}
                >
                  <ProviderLogo provider={provider} />
                  <span>
                    <strong>{providerNames[provider]}</strong>
                    <small>
                      {connections.some((item) => item.settings.provider === provider && item.error)
                        ? 'Needs attention'
                        : count
                          ? `${count > 1 ? `${count} connections` : 'Connected'}`
                          : 'Not connected'}
                    </small>
                  </span>
                  {count > 0 && (
                    <Check
                      size={14}
                      className="assistant-provider-connected"
                      aria-label="Connected"
                    />
                  )}
                </button>
              );
            })}
            <div className="assistant-connections-security">
              <ShieldCheck size={15} />
              <span>API keys are secured by your device.</span>
            </div>
          </nav>
          <form
            className="assistant-connections-content"
            onSubmit={(event) => {
              event.preventDefault();
              void (removing ? disconnect() : connect());
            }}
          >
            {removing ? (
              <div className="assistant-disconnect-view">
                <span className="assistant-disconnect-icon">
                  <Unplug size={24} />
                </span>
                <h3>Disconnect {providerNames[settings.provider]}?</h3>
                <p>
                  {settings.local
                    ? 'This local connection will be removed from this device.'
                    : sharedKey
                      ? 'This connection will be removed. Its API key stays available to your other connections at this endpoint.'
                      : 'This connection and its saved API key will be removed from this device.'}{' '}
                  Your conversations stay saved.
                </p>
                <div className="assistant-disconnect-target">
                  <ProviderLogo provider={settings.provider} />
                  <span>{settings.endpoint}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="assistant-connection-heading">
                  <ProviderLogo provider={settings.provider} />
                  <h3>{providerNames[settings.provider]}</h3>
                  <span className={`assistant-connection-status ${connected ? 'connected' : ''}`}>
                    {connected ? (
                      <>
                        <Check size={12} /> Connected
                      </>
                    ) : (
                      'Not connected'
                    )}
                  </span>
                </div>
                {custom &&
                  connections.filter((item) => item.settings.provider === settings.provider)
                    .length > 0 && (
                    <div className="assistant-endpoint-list" aria-label="Saved endpoints">
                      {connections
                        .filter((item) => item.settings.provider === settings.provider)
                        .map((item) => (
                          <button
                            type="button"
                            key={item.settings.endpoint}
                            disabled={busy}
                            aria-pressed={settings.endpoint === item.settings.endpoint}
                            onClick={() => selectProvider(settings.provider, item.settings)}
                          >
                            {item.settings.endpoint}
                          </button>
                        ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          selectProvider(settings.provider, ASSISTANT_DEFAULTS[settings.provider])
                        }
                      >
                        Add endpoint
                      </button>
                    </div>
                  )}
                {custom ? (
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
                        lookupVersion.current += 1;
                        const endpoint = event.target.value;
                        let local = false;
                        try {
                          local = ['localhost', '127.0.0.1', '[::1]'].includes(
                            new URL(endpoint).hostname,
                          );
                        } catch {
                          /* Native validation explains incomplete URLs. */
                        }
                        setSettings({ ...settings, endpoint, local, model: '' });
                        setCredentialPresent(false);
                        setCredential('');
                        setNotice(null);
                        setError(null);
                      }}
                      onBlur={() => void inspect(settings)}
                    />
                  </label>
                ) : (
                  <p className="assistant-provider-endpoint">{settings.endpoint}</p>
                )}
                {settings.local ? (
                  <div className="assistant-connection-info">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Runs on your device</strong>
                      <p>No API key is needed. Start your local server, then connect.</p>
                    </div>
                  </div>
                ) : credentialPresent && !replaceKey ? (
                  <div className="assistant-connection-saved-key">
                    <KeyRound size={17} />
                    <div>
                      <strong>API key saved securely</strong>
                      <span>
                        {connected
                          ? 'Ready to use in the assistant'
                          : 'Verify the connection to finish setup'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setReplaceKey(true);
                        setNotice(null);
                      }}
                    >
                      Replace key
                    </button>
                  </div>
                ) : (
                  <label className="assistant-connection-field">
                    API key
                    <div className="assistant-key-input">
                      <input
                        aria-label="Assistant API key"
                        type={showKey ? 'text' : 'password'}
                        value={credential}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                        placeholder="Paste your API key"
                        onChange={(event) => setCredential(event.target.value)}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                        aria-pressed={showKey}
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {replaceKey && (
                      <button
                        type="button"
                        className="assistant-key-cancel"
                        disabled={busy}
                        onClick={() => {
                          setReplaceKey(false);
                          setCredential('');
                          setShowKey(false);
                        }}
                      >
                        Keep saved key
                      </button>
                    )}
                  </label>
                )}
                <p className="assistant-connection-consent">
                  Messages and the active project are sent to the provider you choose when you send
                  a message.
                </p>
                {connection && (
                  <button
                    type="button"
                    className="assistant-connection-disconnect"
                    disabled={busy}
                    onClick={() => {
                      setRemoving(true);
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    <Unplug size={14} />
                    Disconnect {providerNames[settings.provider]}
                  </button>
                )}
              </>
            )}
            {(error || connection?.error) && (
              <p className="assistant-connection-error" role="alert">
                {error || connection?.error}
              </p>
            )}
            {notice && (
              <p className="assistant-connection-notice" role="status">
                <CheckCircle2 size={16} />
                {notice}
              </p>
            )}
            <footer className="assistant-connections-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => (removing ? setRemoving(false) : onClose())}
              >
                {removing ? (
                  <>
                    <ArrowLeft size={14} />
                    Keep connection
                  </>
                ) : (
                  'Done'
                )}
              </button>
              <button
                type="submit"
                className={
                  removing ? 'assistant-disconnect-submit' : 'primary assistant-connection-submit'
                }
                disabled={busy || (!removing && !canConnect)}
              >
                {busy && <LoaderCircle size={15} className="assistant-connection-spinner" />}
                {busy
                  ? removing
                    ? 'Disconnecting…'
                    : 'Checking connection…'
                  : removing
                    ? 'Disconnect'
                    : connected
                      ? replaceKey
                        ? 'Update connection'
                        : 'Test connection'
                      : 'Connect'}
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
