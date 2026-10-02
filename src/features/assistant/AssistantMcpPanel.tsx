import { useState } from 'react';
import { ChevronDown, Copy, Plug } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [scopes, setScopes] = useState<AssistantMcpScope[]>(['help']);
  const [copied, setCopied] = useState(false);
  const enabled = !!configuration?.enabled;
  const registration = configuration?.command
    ? JSON.stringify(
        { mcpServers: { phyra: { command: configuration.command, args: configuration.args } } },
        null,
        2,
      )
    : null;
  return (
    <section className="assistant-mcp">
      <button
        type="button"
        className="assistant-mcp-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <Plug size={14} />
        <span>
          Local MCP access <small>{enabled ? 'Enabled · read only' : 'Off'}</small>
        </span>
        <ChevronDown size={13} />
      </button>
      {expanded && (
        <div className="assistant-mcp-body">
          <p>
            Allow a local stdio client to inspect the selected scopes. No model changes, runs,
            exports, shell or arbitrary files are exposed.
          </p>
          <div className="assistant-mcp-scopes">
            {(['help', 'project', 'run'] as AssistantMcpScope[]).map((scope) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  disabled={enabled || busy}
                  onChange={(event) =>
                    setScopes(
                      event.target.checked
                        ? [...scopes, scope]
                        : scopes.filter((item) => item !== scope),
                    )
                  }
                />
                {scope === 'help'
                  ? 'Offline documentation'
                  : scope === 'project'
                    ? 'Active project definition'
                    : 'Active run summary'}
              </label>
            ))}
          </div>
          <p>
            Active project: {activeName ?? 'None'}. Access follows the active tab and expires after
            the app stops refreshing its session.
          </p>
          <div className="assistant-mcp-actions">
            <button
              type="button"
              disabled={busy || (!enabled && !scopes.length)}
              onClick={() => onConfigure(enabled ? [] : scopes)}
            >
              {busy ? 'Updating…' : enabled ? 'Revoke access' : 'Enable selected scopes'}
            </button>
            {enabled && (
              <button type="button" onClick={onAudit}>
                Refresh audit
              </button>
            )}
          </div>
          {registration && enabled && (
            <details>
              <summary>Client configuration · {configuration.protocolVersion}</summary>
              <p>
                Copy into the MCP configuration of a local stdio-capable client. This grants the
                scopes above until revoked. Restart the client after enabling a new session.
              </p>
              <pre>{registration}</pre>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(registration)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
                }
              >
                <Copy size={12} />
                {copied ? 'Copied' : 'Copy configuration'}
              </button>
            </details>
          )}
          {audit.length > 0 && (
            <div className="assistant-mcp-audit" aria-label="MCP access audit">
              {audit
                .slice(-8)
                .reverse()
                .map((item, index) => (
                  <p key={`${item.time}-${index}`}>
                    <time>{new Date(item.time).toLocaleTimeString()}</time> · {item.tool} ·{' '}
                    {item.allowed ? 'allowed' : 'denied'}
                    {item.revision !== null && ` · revision ${item.revision}`}
                  </p>
                ))}
            </div>
          )}
          {error && (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
