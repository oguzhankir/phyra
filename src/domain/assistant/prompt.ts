import type { AssistantMessage } from './types';

export function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
export function conversationTitle(question: string): string {
  let title = '',
    bytes = 0,
    count = 0;
  for (const character of question.trim()) {
    const size = textBytes(character);
    if (bytes + size > 160 || count === 80) break;
    title += character;
    bytes += size;
    count++;
  }
  return title || 'New conversation';
}
export function promptHistory(
  messages: AssistantMessage[],
  context: string,
  system: string,
  question: string,
) {
  const pairs: { role: 'user' | 'assistant'; content: string }[][] = [];
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index],
      reply = messages[index + 1];
    if (
      user.role === 'user' &&
      reply.role === 'assistant' &&
      user.status === 'complete' &&
      reply.status === 'complete' &&
      reply.content
    ) {
      pairs.push([
        { role: 'user', content: user.content },
        { role: 'assistant', content: reply.content },
      ]);
      index++;
    }
  }
  const included: { role: 'user' | 'assistant'; content: string }[][] = [];
  let remaining = 256 * 1024 - textBytes(context) - textBytes(system) - textBytes(question);
  for (let index = pairs.length - 1; index >= 0 && included.length < 19; index--) {
    const pair = pairs[index];
    const bytes = pair.map((item) => textBytes(item.content));
    if (bytes.some((value) => value > 64 * 1024) || bytes[0] + bytes[1] > remaining) break;
    included.unshift(pair);
    remaining -= bytes[0] + bytes[1];
  }
  return {
    messages: included.flat(),
    includedTurns: included.length,
    omittedTurns: pairs.length - included.length,
    fits: remaining >= 0 && textBytes(question) <= 64 * 1024 && textBytes(context) <= 128 * 1024,
  };
}
