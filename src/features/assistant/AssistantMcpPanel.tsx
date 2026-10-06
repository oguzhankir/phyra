import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileBox,
  Info,
  PlugZap,
  Power,
  RefreshCw,
  Terminal,
  Workflow,
} from 'lucide-react';
import type {
  AssistantMcpAudit,
  AssistantMcpConfiguration,
  AssistantMcpTool,
} from '../../domain/assistant/types';
import { mcpClientConfiguration, type McpClient } from './mcpClientConfiguration';
import './AssistantMcpPanel.css';

const tools: {
  id: AssistantMcpTool;
  name: string;
  description: string;
  icon: typeof Info;
  needsProject?: boolean;
}[] = [
  {
    id: 'phyra_capabilities',
    name: 'Inspect capabilities',
    description: 'Available features and supported operations',
    icon: Info,
  },
  {
    id: 'phyra_help',
    name: 'Search product help',
    description: 'Offline guides, equations and references',
    icon: BookOpen,
  },
  {
    id: 'phyra_project',
    name: 'Read project and CAD',
    description: 'Authored geometry, CAD evaluation and analysis definition',
    icon: FileBox,
    needsProject: true,
  },
  {
    id: 'phyra_run',
    name: 'Inspect analysis results',
    description: 'Run status, provenance and result summaries',
    icon: Workflow,
    needsProject: true,
  },
];
const tabs = [
  { id: 'tools', label: 'Tools' },
  { id: 'client', label: 'Connect client' },
  { id: 'log', label: 'Access log' },
] as const;
type Tab = (typeof tabs)[number]['id'];

export default function AssistantMcpPanel({
  configuration,
  audit,
  busy,
  auditBusy,
  clientBusy,
  error,
  activeName,
  onConfigure,
  onAudit,
  onOpenClient,
}: {
  configuration: AssistantMcpConfiguration | null;
  audit: AssistantMcpAudit[];
  busy: boolean;
  auditBusy: boolean;
  clientBusy: boolean;
  error: string | null;
  activeName: string | null;
  onConfigure: (tools: AssistantMcpTool[]) => void;
  onAudit: () => void;
  onOpenClient: () => void;
}) {
  const [selectedTools, setSelectedTools] = useState<AssistantMcpTool[]>(() =>
    tools.filter((tool) => !tool.needsProject || activeName).map((tool) => tool.id),
  );
  const [tab, setTab] = useState<Tab>('tools');
  const [client, setClient] = useState<McpClient>('vscode');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const enabled = !!configuration?.enabled;
  const selection = enabled ? configuration.tools : selectedTools;
  const registration = mcpClientConfiguration(configuration, client);
  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [registration]);

  function selectTab(next: Tab) {
    setTab(next);
    if (next === 'log') onAudit();
  }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].id);
    document.getElementById(`assistant-mcp-tab-${tabs[next].id}`)?.focus();
  }
  async function copyConfiguration() {
    if (!registration) return;
    try {
      await navigator.clipboard.writeText(registration);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError('Could not copy. Select the configuration and copy it manually.');
    }
  }

  return (
    <section className="assistant-mcp" aria-label="Phyra MCP integration">
      <header className="assistant-mcp-header">
        <span className="assistant-mcp-mark">
          <PlugZap size={21} />
        </span>
        <div>
          <h3>Local MCP</h3>
          <p>Bring Phyra tools to your AI client.</p>
        </div>
        <span className={`assistant-mcp-status ${enabled ? 'is-ready' : ''}`}>
          <span />
          {enabled ? 'Ready' : 'Offline'}
        </span>
      </header>
      <div className="assistant-mcp-control">
        <div>
          <strong>{enabled ? 'Available to local clients' : 'Start in one step'}</strong>
          <p>
            {enabled
              ? `${selection.length} tools enabled${activeName ? ` · ${activeName}` : ''}`
              : 'Choose your tools, then connect a desktop client.'}
          </p>
        </div>
        <button
          type="button"
          className={enabled ? 'assistant-mcp-stop' : 'primary'}
          disabled={busy || (!enabled && !selection.length)}
          onClick={() => {
            if (!enabled) setTab('client');
            onConfigure(enabled ? [] : selection);
          }}
        >
          <Power size={15} />
          {busy ? 'Updating…' : enabled ? 'Stop MCP' : 'Start MCP'}
        </button>
      </div>
      <nav className="assistant-mcp-tabs" role="tablist" aria-label="MCP settings">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`assistant-mcp-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="assistant-mcp-page"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div
        id="assistant-mcp-page"
        className="assistant-mcp-page"
        role="tabpanel"
        aria-labelledby={`assistant-mcp-tab-${tab}`}
      >
        {tab === 'tools' && (
          <>
            <div className="assistant-mcp-tool-list">
              {tools.map((tool) => {
                const Icon = tool.icon;
                const checked = selection.includes(tool.id);
                return (
                  <div className="assistant-mcp-tool" key={tool.id}>
                    <span className="assistant-mcp-tool-icon">
                      <Icon size={17} />
                    </span>
                    <label htmlFor={`assistant-mcp-tool-${tool.id}`}>
                      <strong>{tool.name}</strong>
                      <span>{tool.description}</span>
                    </label>
                    <button
                      id={`assistant-mcp-tool-${tool.id}`}
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={tool.name}
                      className="assistant-mcp-switch"
                      disabled={busy || (!checked && !!tool.needsProject && !activeName)}
                      onClick={() => {
                        const next = checked
                          ? selection.filter((id) => id !== tool.id)
                          : [...selection, tool.id];
                        setSelectedTools(next);
                        if (enabled) onConfigure(next);
                      }}
                    >
                      <span />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="assistant-mcp-note">
              Tools read snapshots of the active project. Changes to enabled tools require
              reconnecting your client.
            </p>
          </>
        )}
        {tab === 'client' && (
          <div className="assistant-mcp-client">
            <div className="assistant-mcp-client-choices" role="group" aria-label="Client format">
              <button
                type="button"
                aria-pressed={client === 'vscode'}
                onClick={() => setClient('vscode')}
              >
                VS Code
              </button>
              <button
                type="button"
                aria-pressed={client === 'other'}
                onClick={() => setClient('other')}
              >
                Claude / other clients
              </button>
            </div>
            <p className="assistant-mcp-client-description">
              {client === 'vscode'
                ? 'Open VS Code to review and install this local server, or copy its configuration.'
                : 'Add this configuration to your client’s MCP settings, then restart its Phyra server.'}
            </p>
            <div className="assistant-mcp-client-actions">
              {client === 'vscode' && (
                <button
                  type="button"
                  className="primary"
                  disabled={!registration || busy || clientBusy}
                  onClick={onOpenClient}
                >
                  <ExternalLink size={14} />
                  {clientBusy ? 'Opening…' : 'Open in VS Code'}
                </button>
              )}
              <button
                type="button"
                disabled={!registration || busy}
                onClick={() => void copyConfiguration()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy configuration'}
              </button>
            </div>
            {registration ? (
              <pre
                className="assistant-mcp-configuration"
                tabIndex={0}
                aria-label="Client configuration"
              >
                <code>{registration}</code>
              </pre>
            ) : (
              <div className="assistant-mcp-empty">
                <PlugZap size={22} />
                <span>Start MCP to generate your client configuration.</span>
              </div>
            )}
            <p className="assistant-mcp-note">
              Keep Phyra open while using your client. Local stdio · MCP 2025-11-25
            </p>
          </div>
        )}
        {tab === 'log' && (
          <div className="assistant-mcp-terminal">
            <header>
              <span>
                <Terminal size={14} />
                phyra · access log
              </span>
              <button
                type="button"
                disabled={auditBusy}
                onClick={onAudit}
                aria-label="Refresh access log"
              >
                <RefreshCw size={13} className={auditBusy ? 'is-refreshing' : undefined} />
              </button>
            </header>
            <div
              className="assistant-mcp-log"
              role="log"
              aria-live="polite"
              aria-label="MCP access log"
            >
              {!audit.length ? (
                <p className="assistant-mcp-log-empty">
                  <span>›</span>
                  {auditBusy ? 'Reading requests…' : 'Waiting for client requests'}
                </p>
              ) : (
                audit.slice(-100).map((item, index) => (
                  <div className="assistant-mcp-log-line" key={`${item.time}-${index}`}>
                    <time dateTime={new Date(item.time).toISOString()}>
                      {new Date(item.time).toLocaleTimeString([], { hour12: false })}
                    </time>
                    <strong className={item.allowed ? 'is-allowed' : 'is-denied'}>
                      {item.allowed ? 'ALLOW' : 'DENY'}
                    </strong>
                    <span>{item.tool}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {(error || copyError) && (
        <p className="assistant-mcp-error" role="alert">
          {error || copyError}
        </p>
      )}
    </section>
  );
}
