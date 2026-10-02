import { useAssistantConversationSession } from '../features/assistant/session/useAssistantSession';

/** App composition translates document identity into the isolated assistant session contract. */
export function useAssistantSession(owner: string, projectId: string | null, desktop: boolean) {
  return useAssistantConversationSession({ owner, projectId, desktop });
}
