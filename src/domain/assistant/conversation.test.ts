import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_BYTES,
  ConversationRegistry,
  conversationFits,
  updateConversationAnswer,
} from './conversation';
import { textBytes } from './prompt';
import type { AssistantConversation } from './types';

const conversation = (): AssistantConversation => ({
  formatVersion: 1,
  id: crypto.randomUUID(),
  projectId: 'project',
  title: 'History',
  updatedAt: 0,
  messages: [
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'saved text',
      createdAt: 0,
      status: 'interrupted',
    },
  ],
});

describe('shared conversation identity', () => {
  it('retries the latest unsaved text when two documents open the same history', () => {
    const registry = new ConversationRegistry();
    const saved = conversation();
    registry.bind('A', saved);
    registry.bind('B', structuredClone(saved));
    const latest = updateConversationAnswer(saved, saved.messages[0].id, { content: 'new text' });
    registry.publish('A', latest, true);
    expect(registry.get('B')).toBe(latest);
    expect(registry.bind('B', structuredClone(saved))).toBe(latest);
    expect(registry.isUnsaved(saved.id)).toBe(true);
    registry.saved(registry.get('B')!);
    expect(registry.isUnsaved(saved.id)).toBe(false);
  });
  it('does not clear dirty text when an older revision finishes writing', () => {
    const registry = new ConversationRegistry();
    const saved = conversation();
    registry.bind('A', saved);
    const latest = updateConversationAnswer(saved, saved.messages[0].id, { content: 'new text' });
    registry.publish('A', latest, true);
    registry.saved(saved);
    expect(registry.isUnsaved(saved.id)).toBe(true);
    expect(registry.remove(saved.id)).toBe(false);
    expect(registry.get('A')).toBe(latest);
  });
  it('detaches every owner when deleting saved history and keeps other histories', () => {
    const registry = new ConversationRegistry();
    const saved = conversation(),
      other = conversation();
    registry.bind('A', saved);
    registry.bind('B', saved);
    registry.bind('C', other);
    expect(registry.remove(saved.id)).toBe(true);
    expect(registry.get('A')).toBeUndefined();
    expect(registry.get('B')).toBeUndefined();
    expect(registry.get('C')).toBe(other);
  });
});

describe('serialized history capacity', () => {
  it('counts duplicated provenance, Unicode and JSON escape bytes', () => {
    const value = conversation();
    const text = '🙂\n\t"\\'.repeat(10000);
    const context = {
      kind: 'help' as const,
      projectId: null,
      studyId: null,
      revision: null,
      sourceIds: ['formulation'],
      text,
    };
    value.messages = Array.from({ length: 18 }, () => ({
      ...value.messages[0],
      id: crypto.randomUUID(),
      context,
    }));
    expect(textBytes(text) * 18).toBeLessThan(CONVERSATION_BYTES);
    expect(textBytes(JSON.stringify(value))).toBeGreaterThan(CONVERSATION_BYTES);
    expect(conversationFits(value)).toBe(false);
  });
  it('reserves final status and usage metadata without changing accepted text', () => {
    const value = conversation();
    value.messages = Array.from({ length: 5 }, () => ({
      ...value.messages[0],
      id: crypto.randomUUID(),
      content: 'x'.repeat(400000),
    }));
    const overhead = textBytes(JSON.stringify(value)) - 2000000;
    value.messages[4].content += 'x'.repeat(CONVERSATION_BYTES - 4096 - overhead - 2000000);
    expect(conversationFits(value)).toBe(true);
    const candidate = updateConversationAnswer(value, value.messages[4].id, {
      content: value.messages[4].content + '🙂',
    });
    expect(conversationFits(candidate)).toBe(false);
    const final = updateConversationAnswer(value, value.messages[4].id, {
      status: 'cancelled',
      usage: { inputTokens: 123, outputTokens: 456, totalTokens: 579 },
    });
    expect(textBytes(JSON.stringify(final))).toBeLessThan(CONVERSATION_BYTES);
    expect(conversationFits(final, 0)).toBe(true);
    expect(final.messages[4].content).toBe(value.messages[4].content);
  });
  it('bounds message count and individual response bytes independently', () => {
    const value = conversation();
    value.messages[0].content = '🙂'.repeat(128 * 1024 + 1);
    expect(conversationFits(value)).toBe(false);
    value.messages = Array.from({ length: 161 }, () => conversation().messages[0]);
    expect(conversationFits(value)).toBe(false);
  });
  it('rejects invalid provider control text while retaining the valid previous response', () => {
    const value = conversation();
    const invalid = updateConversationAnswer(value, value.messages[0].id, {
      content: value.messages[0].content + '\0invalid',
    });
    expect(conversationFits(invalid)).toBe(false);
    expect(conversationFits(value)).toBe(true);
    expect(value.messages[0].content).toBe('saved text');
  });
});
