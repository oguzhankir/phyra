import { useMemo, useState } from 'react';
import { Clock3, Search, Trash2, X } from 'lucide-react';
import type { AssistantConversationSummary } from '../../domain/assistant/types';
import type { AssistantViewModel } from './session/contract';

export function conversationDateGroup(timestamp: number, now = Date.now()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  if (timestamp >= today.getTime()) return 'Today';
  if (timestamp >= yesterday.getTime()) return 'Yesterday';
  if (timestamp >= week.getTime()) return 'Previous 7 days';
  return 'Earlier';
}
export function conversationHistoryGroups(
  history: AssistantConversationSummary[],
  query: string,
  now = Date.now(),
) {
  const groups = new Map<string, AssistantConversationSummary[]>();
  for (const item of [...history].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue;
    const name = conversationDateGroup(item.updatedAt, now);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups];
}
export default function AssistantHistory({
  session,
  onClose,
}: {
  session: AssistantViewModel;
  onClose: () => void;
}) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const groups = useMemo(
    () => conversationHistoryGroups(session.history, query),
    [session.history, query],
  );
  const locked = session.pending || session.historyBusy || session.unsaved || !!opening;
  return (
    <section className="assistant-history" aria-label="Local assistant history">
      <header>
        <div>
          <strong>Conversations</strong>
          <span>Saved on this device</span>
        </div>
        <button type="button" aria-label="Close conversation history" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <label className="assistant-history-search">
        <Search size={15} />
        <input
          type="search"
          autoFocus
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {groups.length === 0 && (
        <div className="assistant-history-empty">
          <Clock3 size={24} />
          <strong>{query ? 'No matching conversations' : 'Your conversations live here'}</strong>
          <p>{query ? 'Try another title.' : 'Start a conversation to pick it up again later.'}</p>
        </div>
      )}
      {groups.map(([name, items]) => (
        <section key={name} className="assistant-history-group" aria-label={name}>
          <h3>{name}</h3>
          {items.map((item) => (
            <div
              className={`assistant-history-row ${session.conversation.id === item.id ? 'current' : ''}`}
              key={item.id}
            >
              {deleteId === item.id ? (
                <div className="assistant-history-delete">
                  <strong>Delete this conversation?</strong>
                  <span>This removes the saved transcript from this device.</span>
                  <div>
                    <button type="button" disabled={locked} onClick={() => setDeleteId(null)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="assistant-history-delete-confirm"
                      disabled={locked}
                      onClick={() => {
                        void session.removeConversation(item.id).then(() => setDeleteId(null));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={locked}
                    aria-current={session.conversation.id === item.id ? 'page' : undefined}
                    onClick={() => {
                      setOpening(item.id);
                      void session
                        .openConversation(item.id)
                        .then((accepted) => {
                          if (accepted) onClose();
                        })
                        .finally(() => setOpening(null));
                    }}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {opening === item.id
                        ? 'Opening…'
                        : `${item.messageCount} ${item.messageCount === 1 ? 'message' : 'messages'} · ${name === 'Today' ? new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(item.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="assistant-history-remove"
                    disabled={locked}
                    aria-label={`Delete conversation ${item.title}`}
                    onClick={() => setDeleteId(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      ))}
      {session.error && (
        <p className="assistant-error" role="alert">
          {session.error}
        </p>
      )}
    </section>
  );
}
