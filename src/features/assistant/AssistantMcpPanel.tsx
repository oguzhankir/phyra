import { useState } from 'react';
import { BookOpen, Check, Copy, FileBox, Plug, ScrollText } from 'lucide-react';
import type {
  AssistantMcpAudit,
  AssistantMcpConfiguration,
  AssistantMcpScope,
} from '../../domain/assistant/types';

export default function AssistantMcpPanel({
  configuration,
  audit,
  busy,
  error,
  activeName,
  onConfigure,
  onAudit,
}: {
  configuration: AssistantMcpConfiguration | null;
  audit: AssistantMcpAudit[];
  busy: boolean;
  error: string | null;
  activeName: string | null;
  onConfigure: (scopes: AssistantMcpScope[]) => void;
  onAudit: () => void;
}) {
  const [access, setAccess] = useState<'help' | 'project'>('help');
  const [copied, setCopied] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const enabled = !!configuration?.enabled;
  const selected = enabled
    ? configuration!.scopes.includes('project')
      ? 'project'
      : 'help'
    : access;
  const registration = configuration?.command
    ? JSON.stringify(
        { mcpServers: { phyra: { command: configuration.command, args: configuration.args } } },
        null,
        2,
      )
    : null;
  return (
    <section className="assistant-mcp" aria-label="Phyra MCP integration">
      <header className="assistant-mcp-heading">
        <span className="assistant-integration-icon">
          <Plug size={22} />
        </span>
        <div>
          <h3>Phyra MCP</h3>
          <p>Connect a local AI client to your workbench.</p>
        </div>
        <span className={`assistant-connection-badge ${enabled ? 'connected' : ''}`}>
          {enabled ? 'Enabled' : 'Off'}
        </span>
      </header>
      <p className="assistant-settings-note">
        Choose what the client can read. It cannot edit projects or run analyses.
      </p>
      <div className="assistant-access-options" role="group" aria-label="MCP access level">
        <button
          type="button"
          aria-pressed={selected === 'help'}
          disabled={busy || enabled}
          onClick={() => setAccess('help')}
        >
          <BookOpen size={18} />
          <span>
            <strong>Documentation</strong>
            <small>Product help and formulations</small>
          </span>
          {selected === 'help' && <Check size={15} />}
        </button>
        <button
          type="button"
          aria-pressed={selected === 'project'}
          disabled={busy || enabled || !activeName}
          onClick={() => setAccess('project')}
        >
          <FileBox size={18} />
          <span>
            <strong>Current project</strong>
            <small>Help, study definition and run summary</small>
          </span>
          {selected === 'project' && <Check size={15} />}
        </button>
      </div>
      {selected === 'project' && (
        <p className="assistant-mcp-project">
          {activeName ?? 'No active project'} · follows the active project tab
        </p>
      )}
      {!enabled ? (
        <div className="assistant-mcp-connect">
          <button
            type="button"
            className="primary"
            disabled={busy || (access === 'project' && !activeName)}
            onClick={() => {
              setCopied(false);
              setLogOpen(false);
              onConfigure(access === 'project' ? ['help', 'project', 'run'] : ['help']);
            }}
          >
            {busy ? 'Enabling…' : 'Enable MCP'}
          </button>
          <small>Local access ends when disconnected or Phyra stops.</small>
        </div>
      ) : (
        <>
          <div className="assistant-mcp-actions">
            <button
              type="button"
              disabled={!registration || busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(registration!);
                  setCopied(true);
                  setCopyError(null);
                } catch {
                  setCopyError('Copy failed. Select and copy the configuration below.');
                }
              }}
            >
              <Copy size={15} />
              {copied ? 'Copied' : 'Copy configuration'}
            </button>
            <button type="button" disabled={busy} onClick={() => onConfigure([])}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
          <p className="assistant-settings-note">
            Paste this configuration into your local client's MCP settings. Restart the client after
            reconnecting.
          </p>
          <details className="assistant-mcp-config">
            <summary>View client configuration</summary>
            <pre>{registration}</pre>
            <small>stdio · MCP {configuration!.protocolVersion}</small>
          </details>
          <button
            type="button"
            className="assistant-log-toggle"
            aria-expanded={logOpen}
            onClick={() => {
              setLogOpen(!logOpen);
              if (!logOpen) onAudit();
            }}
          >
            <ScrollText size={15} />
            Access log
          </button>
          {logOpen && (
            <div className="assistant-mcp-audit" aria-label="MCP access audit">
              {!audit.length ? (
                <p>No client requests recorded.</p>
              ) : (
                audit
                  .slice(-8)
                  .reverse()
                  .map((item, index) => (
                    <p key={`${item.time}-${index}`}>
                      <time>{new Date(item.time).toLocaleTimeString()}</time>
                      <span>{item.tool}</span>
                      <strong>{item.allowed ? 'Allowed' : 'Denied'}</strong>
                    </p>
                  ))
              )}
              <button type="button" onClick={onAudit}>
                Refresh
              </button>
            </div>
          )}
        </>
      )}
      {(error || copyError) && (
        <p className="assistant-error" role="alert">
          {error || copyError}
        </p>
      )}
    </section>
  );
}
