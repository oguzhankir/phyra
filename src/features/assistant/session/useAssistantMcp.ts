import { useEffect, useRef, useState } from 'react';
import type {
  AssistantMcpAudit,
  AssistantMcpConfiguration,
  AssistantMcpTool,
  AssistantSnapshot,
} from '../../../domain/assistant/types';
import {
  configureAssistantMcp,
  getAssistantMcpAudit,
  openAssistantMcpClient,
  publishAssistantSnapshot,
} from '../../../platform/desktop/assistant';
import { McpLeaseRefresher } from './mcpLeaseRefresh';
import { messageError } from './conversationTurn';

export function useAssistantMcp(snapshot: AssistantSnapshot, desktop: boolean) {
  const [configuration, setConfiguration] = useState<AssistantMcpConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [clientBusy, setClientBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AssistantMcpAudit[]>([]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  const generation = useRef(0);
  const auditRead = useRef(0);
  const openingClient = useRef(false);
  const updating = useRef(false);
  const live = useRef(true);
  const refresher = useRef<McpLeaseRefresher | null>(null);
  if (!refresher.current)
    refresher.current = new McpLeaseRefresher({
      publish: publishAssistantSnapshot,
      revoke: (sessionId) => configureAssistantMcp(sessionId, []),
      current: (value) =>
        live.current && !!configurationRef.current?.enabled && snapshotRef.current === value,
      busy: () => updating.current,
      revoking: () => {
        updating.current = true;
        ++generation.current;
        setBusy(true);
      },
      revoked: (value) => {
        if (live.current) {
          setConfiguration(value);
          setAudit([]);
        }
      },
      error: (message) => {
        if (live.current) setError(message);
      },
      settled: () => {
        updating.current = false;
        if (live.current) setBusy(false);
      },
    });
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      ++generation.current;
      ++auditRead.current;
      refresher.current!.invalidate();
    };
  }, []);
  useEffect(() => {
    if (!desktop || !configuration?.enabled) return;
    const publish = () => void refresher.current!.refresh(snapshotRef.current);
    publish();
    const timer = window.setInterval(publish, 30000);
    return () => window.clearInterval(timer);
  }, [desktop, configuration?.enabled, snapshot]);
  async function configure(tools: AssistantMcpTool[]) {
    if (!desktop || updating.current) return;
    updating.current = true;
    refresher.current!.invalidate();
    setBusy(true);
    setError(null);
    const current = ++generation.current;
    ++auditRead.current;
    setAuditBusy(false);
    try {
      // Revocation must not depend on a valid scientific snapshot or provider key.
      if (tools.length) await publishAssistantSnapshot(snapshotRef.current);
      const value = await configureAssistantMcp(snapshotRef.current.sessionId, tools);
      if (live.current && generation.current === current) {
        setConfiguration(value);
        setAudit([]);
      }
    } catch (failure) {
      if (live.current && generation.current === current)
        setError(messageError(failure) || 'MCP access could not be updated.');
    } finally {
      updating.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function readAudit() {
    if (!desktop) return;
    const current = generation.current;
    const reading = ++auditRead.current;
    setAuditBusy(true);
    setError(null);
    try {
      const value = await getAssistantMcpAudit(snapshotRef.current.sessionId);
      if (live.current && generation.current === current && auditRead.current === reading)
        setAudit(value);
    } catch (failure) {
      if (live.current && generation.current === current && auditRead.current === reading)
        setError(messageError(failure) || 'The access log is unavailable.');
    } finally {
      if (live.current && auditRead.current === reading) setAuditBusy(false);
    }
  }
  async function openClient() {
    if (!desktop || updating.current || openingClient.current || !configurationRef.current?.enabled)
      return;
    openingClient.current = true;
    setClientBusy(true);
    const current = generation.current;
    setError(null);
    try {
      await openAssistantMcpClient(snapshotRef.current.sessionId);
    } catch (failure) {
      if (live.current && generation.current === current)
        setError(
          messageError(failure) || 'VS Code could not be opened. Copy the configuration instead.',
        );
    } finally {
      openingClient.current = false;
      if (live.current) setClientBusy(false);
    }
  }
  return {
    configuration,
    busy,
    auditBusy,
    clientBusy,
    error,
    audit,
    configure,
    readAudit,
    openClient,
  };
}
