import { useEffect, useRef, useState } from 'react';
import type {
  AssistantMcpAudit,
  AssistantMcpConfiguration,
  AssistantMcpScope,
  AssistantSnapshot,
} from '../../../domain/assistant/types';
import {
  configureAssistantMcp,
  getAssistantMcpAudit,
  publishAssistantSnapshot,
} from '../../../platform/desktop/assistant';
import { McpLeaseRefresher } from './mcpLeaseRefresh';

export function useAssistantMcp(snapshot: AssistantSnapshot, desktop: boolean) {
  const [configuration, setConfiguration] = useState<AssistantMcpConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AssistantMcpAudit[]>([]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  const generation = useRef(0);
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
  async function configure(scopes: AssistantMcpScope[]) {
    if (!desktop || updating.current) return;
    updating.current = true;
    refresher.current!.invalidate();
    setBusy(true);
    setError(null);
    const current = ++generation.current;
    try {
      // Revocation must not depend on a valid scientific snapshot or provider key.
      if (scopes.length) await publishAssistantSnapshot(snapshotRef.current);
      const value = await configureAssistantMcp(snapshotRef.current.sessionId, scopes);
      if (live.current && generation.current === current) {
        setConfiguration(value);
        setAudit([]);
      }
    } catch (failure) {
      if (live.current && generation.current === current)
        setError(typeof failure === 'string' ? failure : 'MCP access could not be updated.');
    } finally {
      updating.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function readAudit() {
    const current = generation.current;
    try {
      const value = await getAssistantMcpAudit(snapshotRef.current.sessionId);
      if (live.current && generation.current === current) setAudit(value);
    } catch (failure) {
      if (live.current && generation.current === current)
        setError(typeof failure === 'string' ? failure : 'The access log is unavailable.');
    }
  }
  return { configuration, busy, error, audit, configure, readAudit };
}
