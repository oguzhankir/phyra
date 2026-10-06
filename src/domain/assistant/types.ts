import type { ProjectDefinition as Project } from '../contracts/types';

export type AssistantProvider = 'gemini' | 'openai' | 'anthropic' | 'compatible' | 'ollama';
export interface AssistantSettings {
  provider: AssistantProvider;
  model: string;
  endpoint: string;
  local: boolean;
}
export interface AssistantConfiguration {
  settings: AssistantSettings;
  credentialPresent: boolean;
  connections: AssistantConnection[];
}
export interface AssistantConnection {
  settings: AssistantSettings;
  credentialPresent: boolean;
  models: AssistantModel[];
  error?: string;
}
export interface AssistantModel {
  id: string;
  name: string;
  streaming: 'supported' | 'unknown';
  contextTokens: number | null;
  outputTokens: number | null;
}
export interface AssistantUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}
export interface AssistantContext {
  kind: 'help' | 'project' | 'study';
  projectId: string | null;
  studyId: string | null;
  revision: number | null;
  sourceIds: string[];
  text: string;
}
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status: 'complete' | 'cancelled' | 'error' | 'interrupted';
  provider?: AssistantProvider;
  model?: string;
  endpoint?: string;
  local?: boolean;
  remoteAllowed?: boolean;
  context?: AssistantContext;
  usage?: AssistantUsage;
}
export interface AssistantConversation {
  formatVersion: 1;
  id: string;
  projectId: string | null;
  title: string;
  updatedAt: number;
  messages: AssistantMessage[];
}
export interface AssistantRequest {
  requestId: string;
  sessionId: string;
  conversationId: string;
  projectId: string | null;
  settings: AssistantSettings;
  messages: Pick<AssistantMessage, 'role' | 'content'>[];
  system: string;
  context: AssistantContext;
  allowRemote: boolean;
  maxOutputTokens: number;
}
export interface AssistantCompletion {
  requestId: string;
  sessionId: string;
  status: 'complete' | 'cancelled';
  text: string;
  usage: AssistantUsage;
}
export interface AssistantEvent {
  requestId: string;
  sessionId: string;
  sequence: number;
  type: 'started' | 'text' | 'usage' | 'complete' | 'cancelled' | 'error';
  text?: string;
  usage?: AssistantUsage;
  message?: string;
}
export interface AssistantConversationSummary {
  id: string;
  projectId: string | null;
  title: string;
  updatedAt: number;
  messageCount: number;
}
export interface AssistantRunSnapshot {
  jobId: string;
  studyId: string;
  inputFingerprint: string | null;
  state: 'current' | 'stale' | 'running' | 'cancelled' | 'failed';
  summary: string;
}
/** Bounded CAD evidence only: no source bytes, preview arrays or arbitrary paths. */
export interface AssistantCadSnapshot {
  state: 'unevaluated' | 'busy' | 'current';
  dimension: '2d' | '3d';
  outputFeatureId: string | null;
  featureCount: number;
  sketchCount: number;
  assetCount: number;
  sketchSolve?: {
    featureId: string;
    status: string;
    degreesOfFreedom: number | null;
    failedConstraintIds: string[];
    failedConstraintCount: number;
    kernel: string;
    sourceCommit: string;
  } | null;
  evaluation: {
    jobId: string;
    revision: number;
    geometryFingerprint: string;
    outputFeatureId: string;
    summary: string;
  } | null;
}
export interface AssistantSnapshot {
  sessionId: string;
  projectId: string | null;
  revision: number | null;
  project: Project | null;
  run: AssistantRunSnapshot | null;
  cad?: AssistantCadSnapshot | null;
  help: { id: string; title: string; content: string }[];
  capabilities: { id: string; description: string; available: boolean }[];
}
export type AssistantMcpTool = 'phyra_capabilities' | 'phyra_help' | 'phyra_project' | 'phyra_run';
export interface AssistantMcpConfiguration {
  enabled: boolean;
  protocolVersion: '2025-11-25';
  tools: AssistantMcpTool[];
  command: string | null;
  args: string[];
}
export interface AssistantMcpAudit {
  time: number;
  tool: string;
  scope: 'help' | 'project' | 'run' | 'capabilities';
  projectId: string | null;
  revision: number | null;
  allowed: boolean;
}
export const ASSISTANT_DEFAULTS: Record<AssistantProvider, AssistantSettings> = {
  gemini: {
    provider: 'gemini',
    model: '',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    local: false,
  },
  openai: { provider: 'openai', model: '', endpoint: 'https://api.openai.com/v1', local: false },
  anthropic: {
    provider: 'anthropic',
    model: '',
    endpoint: 'https://api.anthropic.com/v1',
    local: false,
  },
  compatible: { provider: 'compatible', model: '', endpoint: '', local: false },
  ollama: { provider: 'ollama', model: '', endpoint: 'http://127.0.0.1:11434/v1', local: true },
};
