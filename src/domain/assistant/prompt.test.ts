import { describe, expect, it } from 'vitest';
import { conversationTitle, promptHistory, textBytes } from './prompt';
import type { AssistantMessage } from './types';
const turn = (
  content: string,
  status: AssistantMessage['status'] = 'complete',
): AssistantMessage[] => [
  { id: crypto.randomUUID(), role: 'user', content: 'Question', createdAt: 0, status: 'complete' },
  { id: crypto.randomUUID(), role: 'assistant', content, createdAt: 0, status },
];
describe('bounded disclosed conversation input', () => {
  it('keeps non-Latin conversation titles within native byte limits without splitting characters', () => {
    expect(textBytes(conversationTitle('日本語'.repeat(80)))).toBeLessThanOrEqual(160);
    expect(conversationTitle('🙂'.repeat(80))).toBe('🙂'.repeat(40));
    expect(conversationTitle('  ')).toBe('New conversation');
  });
  it('includes only complete question/reply pairs in order', () => {
    const history = [...turn('first'), ...turn('cancelled', 'cancelled'), ...turn('latest')];
    expect(promptHistory(history, '', '', 'next').messages.map((item) => item.content)).toEqual([
      'Question',
      'first',
      'Question',
      'latest',
    ]);
  });
  it('limits the recent suffix and discloses omitted turns', () => {
    const history = Array.from({ length: 30 }, (_, index) => turn(String(index))).flat();
    const value = promptHistory(history, '', '', 'next');
    expect(value.includedTurns).toBe(19);
    expect(value.omittedTurns).toBe(11);
    expect(value.messages[1].content).toBe('11');
  });
  it('never truncates an oversized response into a different claim', () => {
    const history = [...turn('earlier'), ...turn('x'.repeat(65537))];
    expect(promptHistory(history, '', '', 'next')).toMatchObject({
      includedTurns: 0,
      omittedTurns: 2,
      fits: true,
    });
  });
  it('counts actual UTF-8 bytes and rejects a too-large context', () => {
    expect(textBytes('İ🙂')).toBe(6);
    expect(promptHistory([], '🙂'.repeat(40000), '', 'question').fits).toBe(false);
  });
});
