import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AssistantConfiguration,
  AssistantSettings,
  AssistantModel,
  AssistantRequest,
  AssistantCompletion,
  AssistantEvent,
  AssistantConversation,
  AssistantConversationSummary,
  AssistantSnapshot,
  AssistantMcpScope,
  AssistantMcpConfiguration,
  AssistantMcpAudit,
} from '../../domain/assistant/types';

const snapshotSequences = new Map<string, number>();

export function getAssistantSettings(): Promise<AssistantConfiguration> {
  return invoke('assistant_get_settings');
}
export function saveAssistantSettings(
  settings: AssistantSettings,
): Promise<AssistantConfiguration> {
  return invoke('assistant_save_settings', { settings });
}
// The password crosses IPC once for secure storage. No native command retrieves it.
export function storeAssistantCredential(
  settings: AssistantSettings,
  credential: string,
): Promise<void> {
  return invoke('assistant_store_credential', { settings, credential });
}
export function deleteAssistantCredential(settings: AssistantSettings): Promise<void> {
  return invoke('assistant_delete_credential', { settings });
}
export function listAssistantModels(settings: AssistantSettings): Promise<AssistantModel[]> {
  return invoke('assistant_list_models', { settings });
}
export function streamAssistant(
  request: AssistantRequest,
  onEvent: (event: AssistantEvent) => void,
): Promise<AssistantCompletion> {
  const channel = new Channel<AssistantEvent>();
  channel.onmessage = (event) => {
    if (event.requestId === request.requestId && event.sessionId === request.sessionId)
      onEvent(event);
  };
  return invoke('assistant_stream', { request, channel });
}
export function cancelAssistant(requestId: string, sessionId: string): Promise<void> {
  return invoke('assistant_cancel', { requestId, sessionId });
}
export function listAssistantConversations(
  projectId: string | null,
): Promise<AssistantConversationSummary[]> {
  return invoke('assistant_list_conversations', { projectId });
}
export function readAssistantConversation(id: string): Promise<AssistantConversation> {
  return invoke('assistant_read_conversation', { id });
}
export function writeAssistantConversation(conversation: AssistantConversation): Promise<void> {
  return invoke('assistant_write_conversation', { conversation });
}
export function deleteAssistantConversation(id: string): Promise<void> {
  return invoke('assistant_delete_conversation', { id });
}
export function publishAssistantSnapshot(snapshot: AssistantSnapshot): Promise<void> {
  const publicationSequence = (snapshotSequences.get(snapshot.sessionId) ?? 0) + 1;
  if (!Number.isSafeInteger(publicationSequence))
    return Promise.reject('Assistant snapshot publication limit reached; restart Phyra.');
  snapshotSequences.set(snapshot.sessionId, publicationSequence);
  return invoke('assistant_publish_snapshot', { snapshot, publicationSequence });
}
export function configureAssistantMcp(
  sessionId: string,
  scopes: AssistantMcpScope[],
): Promise<AssistantMcpConfiguration> {
  return invoke('assistant_configure_mcp', { sessionId, scopes });
}
export function getAssistantMcpAudit(sessionId: string): Promise<AssistantMcpAudit[]> {
  return invoke('assistant_mcp_audit', { sessionId });
}
export function releaseAssistantSession(sessionId: string): Promise<void> {
  snapshotSequences.delete(sessionId);
  return invoke('assistant_release_session', { sessionId });
}
export function openAssistantReference(url: string): Promise<void> {
  return invoke('assistant_open_reference', { url });
}
