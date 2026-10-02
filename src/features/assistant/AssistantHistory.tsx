import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { AssistantViewModel } from './session/contract';

export default function AssistantHistory({
  session,
  onClose,
}: {
  session: AssistantViewModel;
  onClose: () => void;
}) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  return (
    <section className="assistant-history" aria-label="Local assistant history">
      <header>
        <strong>Conversations</strong>
        <button type="button" aria-label="Close conversation history" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {!session.history.length && <p>No saved conversations for this project yet.</p>}
      {session.history.map((item) => (
        <div className="assistant-history-row" key={item.id}>
          <button
            type="button"
            disabled={session.pending || session.historyBusy || session.unsaved}
            aria-current={session.conversation.id === item.id ? 'page' : undefined}
            onClick={() => {
              void session.openConversation(item.id);
              onClose();
            }}
          >
            <strong>{item.title}</strong>
            <small>
              {new Date(item.updatedAt).toLocaleDateString()} · {item.messageCount} messages
            </small>
          </button>
          <button
            type="button"
            disabled={
              session.pending ||
              session.historyBusy ||
              (session.unsaved && session.conversation.id === item.id)
            }
            aria-label={`Delete conversation ${item.title}`}
            onClick={() => setDeleteId(item.id)}
          >
            <Trash2 size={14} />
          </button>
          {deleteId === item.id && (
            <div className="assistant-history-delete">
              <span>Delete this conversation?</span>
              <button
                type="button"
                onClick={() => {
                  void session.removeConversation(item.id);
                  setDeleteId(null);
                }}
              >
                Delete
              </button>
              <button type="button" onClick={() => setDeleteId(null)}>
                Keep
              </button>
            </div>
          )}
        </div>
      ))}
      <small>Saved on this device.</small>
    </section>
  );
}
