import { describe, expect, it, vi } from 'vitest';
import type {
  AssistantCompletion,
  AssistantContext,
  AssistantConversation,
  AssistantEvent,
} from '../../../domain/assistant/types';
import { ASSISTANT_DEFAULTS } from '../../../domain/assistant/types';
import {
  freshConversation,
  prepareConversationTurn,
  runConversationTurn,
  type ConversationTurn,
  type ConversationTurnPorts,
} from './conversationTurn';

const context: AssistantContext = {
  kind: 'help',
  projectId: null,
  studyId: null,
  revision: null,
  sourceIds: ['elasticity'],
  text: 'Versioned elasticity help',
};
const prepare = () =>
  prepareConversationTurn({
    owner: 'document-a',
    sessionId: 'session-a',
    base: freshConversation(null),
    settings: { ...ASSISTANT_DEFAULTS.gemini, model: 'available-model' },
    question: 'Explain the formulation',
    context,
    allowRemote: true,
    system: 'Academic read-only assistance',
  });
const completion = (turn: ConversationTurn, text = 'Complete reply'): AssistantCompletion => ({
  requestId: turn.id,
  sessionId: turn.request.sessionId,
  status: 'complete',
  text,
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
});
const event = (
  turn: ConversationTurn,
  sequence: number,
  text: string,
  other: Partial<AssistantEvent> = {},
): AssistantEvent => ({
  requestId: turn.id,
  sessionId: turn.request.sessionId,
  sequence,
  type: 'text',
  text,
  ...other,
});
const ports = (turn: ConversationTurn): ConversationTurnPorts => ({
  write: vi.fn(async () => {}),
  stream: vi.fn(async () => completion(turn)),
  cancel: vi.fn(async () => {}),
  publish: vi.fn(),
  saved: vi.fn(),
  error: vi.fn(),
  accepted: vi.fn(),
});

describe('independent assistant request transactions', () => {
  it('persists exact context and provenance before contacting the provider', async () => {
    const turn = prepare();
    const services = ports(turn);
    const order: string[] = [];
    services.write = vi.fn(async (value) => {
      order.push('write');
      expect(value.messages[0].context).toEqual(context);
      expect(value.messages[0].remoteAllowed).toBe(true);
      expect(value.messages[0].endpoint).toBe(ASSISTANT_DEFAULTS.gemini.endpoint);
    });
    services.stream = vi.fn(async () => {
      order.push('stream');
      return completion(turn);
    });
    expect(await runConversationTurn(turn, services)).toBe(true);
    expect(order).toEqual(['write', 'stream', 'write']);
    expect(services.accepted).toHaveBeenCalledTimes(1);
    expect(turn.conversation.messages[1].status).toBe('complete');
    expect(turn.conversation.messages[1].content).toBe('Complete reply');
    expect(services.saved).toHaveBeenCalledTimes(2);
  });

  it('copies mutable host inputs before asynchronous work begins', () => {
    const settings = { ...ASSISTANT_DEFAULTS.gemini, model: 'original-model' };
    const supplied = { ...context, sourceIds: [...context.sourceIds] };
    const turn = prepareConversationTurn({
      owner: 'document-a',
      sessionId: 'session-a',
      base: freshConversation(null),
      settings,
      question: 'Explain',
      context: supplied,
      allowRemote: true,
      system: 'System',
    });
    settings.model = 'changed-model';
    supplied.text = 'Other study';
    supplied.sourceIds.push('unapproved-source');
    expect(turn.request.settings.model).toBe('original-model');
    expect(turn.request.context).toEqual(context);
    expect(turn.conversation.messages[0].context).toEqual(context);
  });

  it('ignores duplicate, out-of-order and differently owned stream events', async () => {
    const turn = prepare();
    const services = ports(turn);
    const visible: string[] = [];
    services.publish = (value) => visible.push(value.messages[1].content);
    services.stream = async (_, emit) => {
      emit(event(turn, 1, 'first'));
      emit(event(turn, 1, 'duplicate'));
      emit(event(turn, 0, 'late'));
      emit(event(turn, 9, 'wrong request', { requestId: 'other-request' }));
      emit(event(turn, 10, 'wrong session', { sessionId: 'other-session' }));
      emit(event(turn, 2, ' second'));
      return completion(turn, 'first second');
    };
    await runConversationTurn(turn, services);
    expect(visible).toContain('first second');
    expect(visible.join()).not.toMatch(/duplicate|late|wrong/);
    expect(turn.sequence).toBe(2);
  });

  it('cancellation during the first history write never contacts the provider', async () => {
    const turn = prepare();
    const services = ports(turn);
    services.write = vi.fn(async () => {
      turn.cancelled = true;
    });
    expect(await runConversationTurn(turn, services)).toBe(false);
    expect(services.stream).not.toHaveBeenCalled();
    expect(services.write).toHaveBeenCalledTimes(2);
    expect(turn.conversation.messages[1].status).toBe('cancelled');
  });

  it('preserves partial output on cancellation and ignores subsequent chunks', async () => {
    const turn = prepare();
    const services = ports(turn);
    services.stream = async (_, emit) => {
      emit(event(turn, 0, 'retained partial'));
      turn.cancelled = true;
      emit(event(turn, 1, 'after cancel'));
      return completion(turn, 'provider completed despite cancellation');
    };
    await runConversationTurn(turn, services);
    expect(turn.conversation.messages[1].content).toBe('retained partial');
    expect(turn.conversation.messages[1].status).toBe('cancelled');
  });

  it('does not send a turn whose initial local history write fails', async () => {
    const turn = prepare();
    const services = ports(turn);
    services.write = vi.fn(async () => {
      throw new Error('Storage unavailable');
    });
    expect(await runConversationTurn(turn, services)).toBe(false);
    expect(services.stream).not.toHaveBeenCalled();
    expect(services.accepted).not.toHaveBeenCalled();
    expect(services.publish).not.toHaveBeenCalled();
    expect(services.error).toHaveBeenCalledWith('Message could not be saved: Storage unavailable');
  });

  it('retains a retryable transcript when the final history write fails', async () => {
    const turn = prepare();
    const services = ports(turn);
    let writes = 0;
    services.write = vi.fn(async () => {
      if (++writes === 2) throw new Error('Disk full');
    });
    await runConversationTurn(turn, services);
    expect(services.publish).toHaveBeenLastCalledWith(turn.conversation, true);
    expect(services.error).toHaveBeenCalledWith('Conversation could not be saved: Disk full');
    expect(services.saved).toHaveBeenCalledTimes(1);
  });

  it('rejects provider completions belonging to another request', async () => {
    const turn = prepare();
    const services = ports(turn);
    services.stream = async () => ({ ...completion(turn), requestId: 'other-request' });
    await runConversationTurn(turn, services);
    expect(turn.conversation.messages[1].content).toBe('');
    expect(turn.conversation.messages[1].status).toBe('error');
    expect(services.error).toHaveBeenCalledWith(
      'The assistant response belongs to another request.',
    );
  });

  it('stops invalid provider text while saving the valid partial response', async () => {
    const turn = prepare();
    const services = ports(turn);
    services.stream = async (_, emit) => {
      emit(event(turn, 0, 'valid partial'));
      emit(event(turn, 1, '\0invalid'));
      return completion(turn, 'other final text');
    };
    await runConversationTurn(turn, services);
    expect(services.cancel).toHaveBeenCalledWith(turn.id, turn.request.sessionId);
    expect(turn.conversation.messages[1].content).toBe('valid partial');
    expect(turn.conversation.messages[1].status).toBe('cancelled');
  });

  it('fails bounded local history checks before requesting transport', () => {
    const base: AssistantConversation = freshConversation(null);
    base.messages = Array.from({ length: 159 }, (_, index) => ({
      id: `message-${index}`,
      role: 'user',
      content: 'Question',
      createdAt: 0,
      status: 'complete',
    }));
    expect(() =>
      prepareConversationTurn({
        owner: 'document-a',
        sessionId: 'session-a',
        base,
        settings: { ...ASSISTANT_DEFAULTS.gemini, model: 'available-model' },
        question: 'Explain',
        context,
        allowRemote: true,
        system: 'System',
      }),
    ).toThrow('local history limit');
  });
});
