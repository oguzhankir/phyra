import type { AssistantContext, AssistantConversation, AssistantSettings } from './types';

export type SharingScope = 'help' | 'study';

export function sharingScope(
  conversation: AssistantConversation,
  context: AssistantContext,
): SharingScope {
  return context.kind === 'study' ||
    conversation.messages.some((message) => message.context?.kind === 'study')
    ? 'study'
    : 'help';
}

function origin(settings: AssistantSettings): string {
  try {
    return new URL(settings.endpoint).origin;
  } catch {
    return settings.endpoint;
  }
}

export function sharingIdentity(
  conversation: AssistantConversation,
  settings: AssistantSettings,
  scope: SharingScope,
): string {
  return JSON.stringify([
    conversation.id,
    conversation.projectId,
    settings.provider,
    origin(settings),
    scope,
  ]);
}

// A saved, explicitly approved user turn records permission to continue this
// conversation with that provider origin. Expanding from help to study needs approval.
// Model changes at the same origin do not send data to a new recipient.
export function previouslyApproved(
  conversation: AssistantConversation,
  settings: AssistantSettings,
  scope: SharingScope,
): boolean {
  return conversation.messages.some(
    (message) =>
      message.role === 'user' &&
      message.remoteAllowed === true &&
      message.local === false &&
      message.provider === settings.provider &&
      !!message.endpoint &&
      origin({ ...settings, endpoint: message.endpoint }) === origin(settings) &&
      (scope === 'help' || message.context?.kind === 'study'),
  );
}
