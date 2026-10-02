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
import {
  ConversationRegistry,
  conversationFits,
  updateConversationAnswer,
} from '../domain/assistant/conversation';
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
  const conversations = useRef(new ConversationRegistry());
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [conversation, setConversation] = useState(() => fresh(projectId));
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listAssistantConversations>>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
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

  function publish(key: string, value: AssistantConversation, dirty = false) {
    conversations.current.publish(key, value, dirty);
    const visible = conversations.current.get(ownerRef.current);
    if (live.current && visible?.id === value.id) {
      setConversation(visible);
      setUnsaved(conversations.current.isUnsaved(visible.id));
    }
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

  async function send(
    question: string,
    context: AssistantContext,
    allowRemote: boolean,
    onAccepted?: () => void,
  ) {
    if (!desktop || !configuration || requestRef.current || historyBusy || unsaved) return false;
    if (!configuration.settings.model.trim()) {
      setError('Choose a model in Assistant settings.');
      return false;
    }
    const key = owner;
    const base = conversations.current.get(key) ?? conversation;
    const input = promptHistory(base.messages, context.text, ASSISTANT_SYSTEM, question);
    if (!input.fits) {
      setError('The question or attached context exceeds the supported request limits.');
      return false;
    }
    if (base.messages.length > 158) {
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
    if (!conversationFits(next)) {
      setError('Start a new conversation; this conversation has reached its local storage limit.');
      return false;
    }
    const running = { id, owner: key, conversation: next, sequence: -1, cancelled: false };
    requestRef.current = running;
    setPending(true);
    setError(null);
    let accepted = false;
    let storageFull = false;
    const replaceAnswer = (update: Partial<AssistantMessage>) => {
      const candidate = updateConversationAnswer(running.conversation, answer.id, update);
      const previousText = running.conversation.messages.find(
        (item) => item.id === answer.id,
      )!.content;
      const addsText = update.content !== undefined && update.content !== previousText;
      if (!conversationFits(candidate, addsText ? 4096 : 0)) {
        storageFull = true;
        running.cancelled = true;
        void cancelAssistant(id, sessionId).catch(() => {});
        if (live.current && ownerRef.current === key)
          setError(
            update.content?.includes('\0')
              ? 'Response stopped because the provider returned invalid text. The valid partial response is retained.'
              : 'Response stopped at the local storage limit. Start a new conversation.',
          );
        return;
      }
      running.conversation = candidate;
      publish(key, candidate, true);
    };
    try {
      // Commit the user turn and context before contacting the provider.
      await writeAssistantConversation(next);
      accepted = true;
      publish(key, running.conversation);
      conversations.current.saved(next);
      onAccepted?.();
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
          messages: [...input.messages, { role: 'user', content: question }],
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
      const displayed = running.conversation.messages.find((item) => item.id === answer.id)!;
      replaceAnswer({
        content: running.cancelled ? displayed.content : completion.text,
        status: running.cancelled ? 'cancelled' : completion.status,
        usage: completion.usage,
      });
      if (storageFull) replaceAnswer({ status: 'cancelled' });
      return true;
    } catch (failure) {
      if (accepted) replaceAnswer({ status: running.cancelled ? 'cancelled' : 'error' });
      if (live.current && ownerRef.current === key && !running.cancelled)
        setError(
          accepted ? messageError(failure) : `Message could not be saved: ${messageError(failure)}`,
        );
      return accepted;
    } finally {
      if (accepted) {
        try {
          await writeAssistantConversation(running.conversation);
          conversations.current.saved(running.conversation);
          publish(key, running.conversation);
        } catch (failure) {
          publish(key, running.conversation, true);
          if (live.current && ownerRef.current === key)
            setError(`Conversation could not be saved: ${messageError(failure)}`);
        }
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
    if (requestRef.current || historyBusy || unsaved) return;
    publish(owner, fresh(projectId));
    setError(null);
  }
  async function openConversation(id: string) {
    if (requestRef.current || historyBusy || unsaved) return;
    setHistoryBusy(true);
    const key = owner;
    try {
      const value = await readAssistantConversation(id);
      if (value.projectId !== projectId)
        throw new Error('This conversation belongs to another project.');
      if (ownerRef.current === key) publish(key, conversations.current.bind(key, value));
    } catch (failure) {
      if (ownerRef.current === key) setError(messageError(failure));
    } finally {
      if (live.current) setHistoryBusy(false);
    }
  }
  async function removeConversation(id: string) {
    if (requestRef.current || historyBusy || conversations.current.isUnsaved(id)) return;
    setHistoryBusy(true);
    try {
      await deleteAssistantConversation(id);
      const visibleOwner = ownerRef.current;
      const visible = conversations.current.get(visibleOwner);
      conversations.current.remove(id);
      if (visible?.id === id) publish(visibleOwner, fresh(visible.projectId));
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
  async function retrySave() {
    if (!desktop || requestRef.current || historyBusy || !unsaved) return;
    const key = owner;
    const value = conversations.current.get(key) ?? conversation;
    setHistoryBusy(true);
    try {
      await writeAssistantConversation(value);
      conversations.current.saved(value);
      publish(key, value);
      if (live.current && ownerRef.current === key) setError(null);
      await refreshHistory();
    } catch (failure) {
      if (live.current && ownerRef.current === key)
        setError(`Conversation could not be saved: ${messageError(failure)}`);
    } finally {
      if (live.current) setHistoryBusy(false);
    }
  }
  async function restoreSaved() {
    if (!desktop || requestRef.current || historyBusy || !unsaved) return;
    const key = owner;
    const current = conversations.current.get(key) ?? conversation;
    setHistoryBusy(true);
    try {
      const saved = await readAssistantConversation(current.id);
      if (saved.projectId !== current.projectId)
        throw new Error('This conversation belongs to another project.');
      conversations.current.publish(key, saved, false);
      conversations.current.saved(saved);
      publish(key, saved);
      if (live.current && ownerRef.current === key) setError(null);
    } catch (failure) {
      if (live.current && ownerRef.current === key) setError(messageError(failure));
    } finally {
      if (live.current) setHistoryBusy(false);
    }
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
    unsaved,
    retrySave,
    restoreSaved,
    send,
    stop,
    newConversation,
    openConversation,
    removeConversation,
  };
}
