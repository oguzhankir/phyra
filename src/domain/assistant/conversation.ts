import { textBytes } from './prompt';
import type { AssistantConversation, AssistantMessage } from './types';

// Match the versioned native history contract, including JSON escaping and duplicated context.
export const CONVERSATION_BYTES = 2 * 1024 * 1024;
const FINAL_METADATA_RESERVE = 4096;
export function conversationFits(
  value: AssistantConversation,
  reserveBytes = FINAL_METADATA_RESERVE,
): boolean {
  return (
    value.messages.length <= 160 &&
    value.messages.every(
      (message) => !message.content.includes('\0') && textBytes(message.content) <= 512 * 1024,
    ) &&
    textBytes(JSON.stringify(value)) <= CONVERSATION_BYTES - reserveBytes
  );
}
export function updateConversationAnswer(
  value: AssistantConversation,
  answerId: string,
  update: Partial<AssistantMessage>,
): AssistantConversation {
  return {
    ...value,
    updatedAt: Date.now(),
    messages: value.messages.map((item) => (item.id === answerId ? { ...item, ...update } : item)),
  };
}

/** Document owners may explicitly open the same history. Its latest text has one identity. */
export class ConversationRegistry {
  private owners = new Map<string, string>();
  private values = new Map<string, AssistantConversation>();
  private dirty = new Set<string>();

  get(owner: string) {
    const id = this.owners.get(owner);
    return id ? this.values.get(id) : undefined;
  }
  bind(owner: string, value: AssistantConversation) {
    this.owners.set(owner, value.id);
    if (!this.values.has(value.id)) this.values.set(value.id, value);
    return this.values.get(value.id)!;
  }
  publish(owner: string, value: AssistantConversation, unsaved: boolean) {
    this.owners.set(owner, value.id);
    this.values.set(value.id, value);
    if (unsaved) this.dirty.add(value.id);
    return value;
  }
  saved(value: AssistantConversation) {
    // A late write cannot mark a newer revision as persisted.
    if (this.values.get(value.id) === value) this.dirty.delete(value.id);
  }
  isUnsaved(id: string) {
    return this.dirty.has(id);
  }
  remove(id: string) {
    if (this.dirty.has(id)) return false;
    for (const [owner, value] of this.owners) if (value === id) this.owners.delete(owner);
    this.values.delete(id);
    return true;
  }
}
