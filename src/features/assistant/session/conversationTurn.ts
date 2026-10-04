import { conversationFits, updateConversationAnswer } from '../../../domain/assistant/conversation';
import { conversationTitle, promptHistory } from '../../../domain/assistant/prompt';
import type {
  AssistantCompletion,
  AssistantContext,
  AssistantConversation,
  AssistantEvent,
  AssistantMessage,
  AssistantRequest,
  AssistantSettings,
} from '../../../domain/assistant/types';

export const messageError = (error: unknown) =>
  typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : 'The assistant request failed.';

export const freshConversation = (projectId: string | null): AssistantConversation => ({
  formatVersion: 1,
  id: crypto.randomUUID(),
  projectId,
  title: 'New conversation',
  updatedAt: Date.now(),
  messages: [],
});

export interface ConversationTurn {
  id: string;
  owner: string;
  conversation: AssistantConversation;
  answerId: string;
  sequence: number;
  cancelled: boolean;
  request: AssistantRequest;
}

/** Snapshot every input before storage or network waits can change the active document. */
export function prepareConversationTurn({
  owner,
  sessionId,
  base,
  settings,
  question,
  context,
  allowRemote,
  system,
}: {
  owner: string;
  sessionId: string;
  base: AssistantConversation;
  settings: AssistantSettings;
  question: string;
  context: AssistantContext;
  allowRemote: boolean;
  system: string;
}): ConversationTurn {
  if (!settings.model.trim()) throw new Error('Choose a model in the assistant.');
  const input = promptHistory(base.messages, context.text, system, question);
  if (!input.fits)
    throw new Error('The question or attached context exceeds the supported request limits.');
  if (base.messages.length > 158)
    throw new Error(
      'Start a new conversation; this conversation has reached its local history limit.',
    );
  const id = crypto.randomUUID();
  const now = Date.now();
  const savedSettings = { ...settings };
  const savedContext = { ...context, sourceIds: [...context.sourceIds] };
  const provenance = {
    provider: savedSettings.provider,
    model: savedSettings.model,
    context: savedContext,
    endpoint: savedSettings.endpoint,
    local: savedSettings.local,
    remoteAllowed: allowRemote,
  };
  const user: AssistantMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: question,
    createdAt: now,
    status: 'complete',
    ...provenance,
  };
  const answer: AssistantMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    createdAt: now,
    status: 'interrupted',
    ...provenance,
  };
  const conversation: AssistantConversation = {
    ...base,
    title: base.messages.length ? base.title : conversationTitle(question),
    updatedAt: now,
    messages: [...base.messages, user, answer],
  };
  if (!conversationFits(conversation))
    throw new Error(
      'Start a new conversation; this conversation has reached its local storage limit.',
    );
  return {
    id,
    owner,
    conversation,
    answerId: answer.id,
    sequence: -1,
    cancelled: false,
    request: {
      requestId: id,
      sessionId,
      conversationId: conversation.id,
      projectId: base.projectId,
      settings: savedSettings,
      messages: [...input.messages, { role: 'user', content: question }],
      system,
      context: savedContext,
      allowRemote,
      maxOutputTokens: 4096,
    },
  };
}

export interface ConversationTurnPorts {
  write: (conversation: AssistantConversation) => Promise<void>;
  stream: (
    request: AssistantRequest,
    onEvent: (event: AssistantEvent) => void,
  ) => Promise<AssistantCompletion>;
  cancel: (requestId: string, sessionId: string) => Promise<void>;
  publish: (conversation: AssistantConversation, unsaved: boolean) => void;
  saved: (conversation: AssistantConversation) => void;
  error: (message: string) => void;
  accepted?: () => void;
}

/** One transaction owns streaming, cancellation and its final ordered history write. */
export async function runConversationTurn(
  turn: ConversationTurn,
  ports: ConversationTurnPorts,
): Promise<boolean> {
  let accepted = false;
  let storageFull = false;
  const answer = () => turn.conversation.messages.find((item) => item.id === turn.answerId)!;
  const replaceAnswer = (update: Partial<AssistantMessage>) => {
    const candidate = updateConversationAnswer(turn.conversation, turn.answerId, update);
    const addsText = update.content !== undefined && update.content !== answer().content;
    if (!conversationFits(candidate, addsText ? 4096 : 0)) {
      storageFull = true;
      turn.cancelled = true;
      void ports.cancel(turn.id, turn.request.sessionId).catch(() => {});
      ports.error(
        update.content?.includes('\0')
          ? 'Response stopped because the provider returned invalid text. The valid partial response is retained.'
          : 'Response stopped at the local storage limit. Start a new conversation.',
      );
      return;
    }
    turn.conversation = candidate;
    ports.publish(candidate, true);
  };
  try {
    // Local history and exact supplied context are durable before contacting a provider.
    await ports.write(turn.conversation);
    accepted = true;
    ports.publish(turn.conversation, false);
    ports.saved(turn.conversation);
    if (turn.cancelled) {
      replaceAnswer({ status: 'cancelled' });
      return false;
    }
    ports.accepted?.();
    const completion = await ports.stream(turn.request, (event) => {
      if (
        event.requestId !== turn.id ||
        event.sessionId !== turn.request.sessionId ||
        event.sequence <= turn.sequence ||
        turn.cancelled
      )
        return;
      turn.sequence = event.sequence;
      if (event.type === 'text' && event.text)
        replaceAnswer({ content: answer().content + event.text });
      if (event.type === 'usage' && event.usage) replaceAnswer({ usage: event.usage });
    });
    if (completion.requestId !== turn.id || completion.sessionId !== turn.request.sessionId)
      throw new Error('The assistant response belongs to another request.');
    replaceAnswer({
      content: turn.cancelled ? answer().content : completion.text,
      status: turn.cancelled ? 'cancelled' : completion.status,
      usage: completion.usage,
    });
    if (storageFull) replaceAnswer({ status: 'cancelled' });
    return true;
  } catch (failure) {
    if (accepted) replaceAnswer({ status: turn.cancelled ? 'cancelled' : 'error' });
    if (!turn.cancelled)
      ports.error(
        accepted ? messageError(failure) : `Message could not be saved: ${messageError(failure)}`,
      );
    return accepted;
  } finally {
    if (accepted) {
      try {
        await ports.write(turn.conversation);
        ports.saved(turn.conversation);
        ports.publish(turn.conversation, false);
      } catch (failure) {
        ports.publish(turn.conversation, true);
        ports.error(`Conversation could not be saved: ${messageError(failure)}`);
      }
    }
  }
}
