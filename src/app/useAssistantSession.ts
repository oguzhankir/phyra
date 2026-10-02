import { useEffect, useRef, useState } from 'react';
import type {
  AssistantConfiguration,
  AssistantContext,
  AssistantConversation,
  AssistantMessage,
  AssistantSettings,
} from '../domain/assistant/types';
import {
  cancelAssistant,
  getAssistantSettings,
  listAssistantConversations,
  readAssistantConversation,
  releaseAssistantSession,
  streamAssistant,
  writeAssistantConversation,
  deleteAssistantConversation,
} from '../platform/desktop/assistant';
import { conversationTitle, promptHistory } from '../domain/assistant/prompt';
import { ASSISTANT_SYSTEM } from '../features/assistant/context';
import { sessionRetirement } from './assistantLifecycle';

const fresh = (projectId: string | null): AssistantConversation => ({
  formatVersion: 1,
  id: crypto.randomUUID(),
  projectId,
  title: 'New conversation',
  updatedAt: Date.now(),
  messages: [],
});
const messageError = (error: unknown) =>
  typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : 'The assistant request failed.';

export function useAssistantSession(owner: string, projectId: string | null, desktop: boolean) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [configuration, setConfiguration] = useState<AssistantConfiguration | null>(null);
  const conversations = useRef(new Map<string, AssistantConversation>());
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [conversation, setConversation] = useState(() => fresh(projectId));
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listAssistantConversations>>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const requestRef = useRef<{
    id: string;
    owner: string;
    conversation: AssistantConversation;
    sequence: number;
    cancelled: boolean;
  } | null>(null);
  const live = useRef(true);
  const settingsGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const retire = useRef<ReturnType<typeof sessionRetirement> | null>(null);
  if (!retire.current) retire.current = sessionRetirement(() => releaseAssistantSession(sessionId));

  function publish(key: string, value: AssistantConversation) {
    conversations.current.set(key, value);
    if (live.current && ownerRef.current === key) setConversation(value);
  }
  async function refreshHistory() {
    if (!desktop || ownerRef.current !== owner) return;
    const generation = ++historyGeneration.current;
    try {
      const items = await listAssistantConversations(projectId);
      if (live.current && generation === historyGeneration.current && ownerRef.current === owner)
        setHistory(items);
    } catch (failure) {
      if (live.current && ownerRef.current === owner) setError(messageError(failure));
    }
  }
  useEffect(() => {
    live.current = true;
    const generation = ++settingsGeneration.current;
    const release = retire.current!();
    if (desktop)
      void getAssistantSettings()
        .then((value) => {
          if (live.current && generation === settingsGeneration.current) setConfiguration(value);
        })
        .catch((failure) => {
          if (live.current && generation === settingsGeneration.current)
            setError(messageError(failure));
        });
    return () => {
      live.current = false;
      if (desktop) release();
    };
  }, [desktop, sessionId]);
  useEffect(() => {
    const previous = requestRef.current;
    if (previous && previous.owner !== owner) {
      previous.cancelled = true;
      void cancelAssistant(previous.id, sessionId).catch(() => {});
    }
    const value = conversations.current.get(owner) ?? fresh(projectId);
    publish(owner, value);
    setError(null);
    setHistory([]);
    void refreshHistory();
    // Owner changes replace only the visible conversation, never another document's transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, projectId, desktop]);

  async function send(question: string, context: AssistantContext, allowRemote: boolean) {
    if (!desktop || !configuration || requestRef.current || historyBusy) return false;
    if (!configuration.settings.model.trim()) {
      setError('Choose a model in Assistant settings.');
      return false;
    }
    const key = owner;
    const base = conversations.current.get(key) ?? conversation;
    if (base.messages.length >= 158) {
      setError('Start a new conversation; this conversation has reached its local history limit.');
      return false;
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const provenance = {
      provider: configuration.settings.provider,
      model: configuration.settings.model,
      context,
      endpoint: configuration.settings.endpoint,
      local: configuration.settings.local,
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
    const next: AssistantConversation = {
      ...base,
      title: base.messages.length ? base.title : conversationTitle(question),
      updatedAt: now,
      messages: [...base.messages, user, answer],
    };
    const running = { id, owner: key, conversation: next, sequence: -1, cancelled: false };
    requestRef.current = running;
    setPending(true);
    setError(null);
    publish(key, next);
    const replaceAnswer = (update: Partial<AssistantMessage>) => {
      const current = running.conversation;
      running.conversation = {
        ...current,
        updatedAt: Date.now(),
        messages: current.messages.map((item) =>
          item.id === answer.id ? { ...item, ...update } : item,
        ),
      };
      publish(key, running.conversation);
    };
    try {
      // Commit the user turn and context before contacting the provider.
      await writeAssistantConversation(next);
      if (running.cancelled) {
        replaceAnswer({ status: 'cancelled' });
        return false;
      }
      const completion = await streamAssistant(
        {
          requestId: id,
          sessionId,
          conversationId: next.id,
          projectId: base.projectId,
          settings: configuration.settings,
          messages: [
            ...promptHistory(base.messages, context.text, ASSISTANT_SYSTEM, question).messages,
            { role: 'user', content: question },
          ],
          system: ASSISTANT_SYSTEM,
          context,
          allowRemote,
          maxOutputTokens: 4096,
        },
        (event) => {
          if (
            requestRef.current !== running ||
            event.sequence <= running.sequence ||
            running.cancelled
          )
            return;
          running.sequence = event.sequence;
          const current = running.conversation.messages.find((item) => item.id === answer.id)!;
          if (event.type === 'text' && event.text)
            replaceAnswer({ content: current.content + event.text });
          if (event.type === 'usage' && event.usage) replaceAnswer({ usage: event.usage });
        },
      );
      replaceAnswer({
        content: completion.text,
        status: running.cancelled ? 'cancelled' : completion.status,
        usage: completion.usage,
      });
      return completion.status === 'complete' && !running.cancelled;
    } catch (failure) {
      replaceAnswer({ status: running.cancelled ? 'cancelled' : 'error' });
      if (live.current && ownerRef.current === key && !running.cancelled)
        setError(messageError(failure));
      return false;
    } finally {
      try {
        await writeAssistantConversation(running.conversation);
      } catch (failure) {
        if (live.current && ownerRef.current === key)
          setError(`Conversation could not be saved: ${messageError(failure)}`);
      }
      if (requestRef.current === running) requestRef.current = null;
      if (live.current) {
        setPending(false);
        if (ownerRef.current === key) void refreshHistory();
      }
    }
  }
  async function stop() {
    const request = requestRef.current;
    if (!request) return;
    request.cancelled = true;
    try {
      await cancelAssistant(request.id, sessionId);
    } catch (failure) {
      setError(messageError(failure));
    }
  }
  function newConversation() {
    if (requestRef.current || historyBusy) return;
    publish(owner, fresh(projectId));
    setError(null);
  }
  async function openConversation(id: string) {
    if (requestRef.current || historyBusy) return;
    setHistoryBusy(true);
    const key = owner;
    try {
      const value = await readAssistantConversation(id);
      if (value.projectId !== projectId)
        throw new Error('This conversation belongs to another project.');
      if (ownerRef.current === key) publish(key, value);
    } catch (failure) {
      if (ownerRef.current === key) setError(messageError(failure));
    } finally {
      if (live.current) setHistoryBusy(false);
    }
  }
  async function removeConversation(id: string) {
    if (requestRef.current || historyBusy) return;
    setHistoryBusy(true);
    try {
      await deleteAssistantConversation(id);
      if (conversation.id === id) publish(owner, fresh(projectId));
      await refreshHistory();
    } catch (failure) {
      setError(messageError(failure));
    } finally {
      if (live.current) setHistoryBusy(false);
    }
  }
  function configured(settings: AssistantSettings, credentialPresent: boolean) {
    ++settingsGeneration.current;
    setConfiguration({ settings, credentialPresent });
    setError(null);
  }
  return {
    sessionId,
    configuration,
    configured,
    conversation,
    history,
    error,
    pending,
    historyBusy,
    send,
    stop,
    newConversation,
    openConversation,
    removeConversation,
  };
}
