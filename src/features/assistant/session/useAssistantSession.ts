import { useEffect, useRef, useState } from 'react';
import type {
  AssistantConfiguration,
  AssistantContext,
  AssistantConversation,
  AssistantSettings,
} from '../../../domain/assistant/types';
import {
  cancelAssistant,
  getAssistantSettings,
  listAssistantConversations,
  readAssistantConversation,
  releaseAssistantSession,
  streamAssistant,
  writeAssistantConversation,
  deleteAssistantConversation,
} from '../../../platform/desktop/assistant';
import { ConversationRegistry } from '../../../domain/assistant/conversation';
import { ASSISTANT_SYSTEM } from '../context';
import { sessionRetirement } from './lifecycle';

import type { AssistantSessionHost, AssistantViewModel } from './contract';
import {
  freshConversation,
  messageError,
  prepareConversationTurn,
  runConversationTurn,
  type ConversationTurn,
} from './conversationTurn';

export function useAssistantConversationSession({
  owner,
  projectId,
  desktop,
}: AssistantSessionHost): AssistantViewModel & { sessionId: string } {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [configuration, setConfiguration] = useState<AssistantConfiguration | null>(null);
  const conversations = useRef(new ConversationRegistry());
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [conversation, setConversation] = useState(() => freshConversation(projectId));
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listAssistantConversations>>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const requestRef = useRef<ConversationTurn | null>(null);
  const live = useRef(true);
  const settingsGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const retire = useRef<ReturnType<typeof sessionRetirement> | null>(null);
  if (!retire.current)
    retire.current = sessionRetirement(() => {
      if (requestRef.current) requestRef.current.cancelled = true;
      return releaseAssistantSession(sessionId);
    });

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
      if (live.current && generation === historyGeneration.current && ownerRef.current === owner)
        setError(messageError(failure));
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
    const value = conversations.current.get(owner) ?? freshConversation(projectId);
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
    if (
      !desktop ||
      !configuration ||
      ownerRef.current !== owner ||
      requestRef.current ||
      historyBusy ||
      unsaved
    )
      return false;
    const key = owner;
    const base = conversations.current.get(key, projectId);
    // React's displayed value can still be the preceding owner until effects adopt
    // the new document. Only the registry is authoritative for outgoing history.
    if (!base) return false;
    let running: ConversationTurn;
    try {
      running = prepareConversationTurn({
        owner: key,
        sessionId,
        base,
        settings: configuration.settings,
        question,
        context,
        allowRemote,
        system: ASSISTANT_SYSTEM,
      });
    } catch (failure) {
      if (live.current && ownerRef.current === key) setError(messageError(failure));
      return false;
    }
    requestRef.current = running;
    setPending(true);
    setError(null);
    try {
      return await runConversationTurn(running, {
        write: writeAssistantConversation,
        stream: streamAssistant,
        cancel: cancelAssistant,
        publish: (value, dirty) => publish(key, value, dirty),
        saved: (value) => conversations.current.saved(value),
        error: (message) => {
          if (live.current && ownerRef.current === key) setError(message);
        },
        accepted: () => {
          if (
            live.current &&
            ownerRef.current === key &&
            requestRef.current === running &&
            !running.cancelled
          )
            onAccepted?.();
        },
      });
    } finally {
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
      if (live.current && ownerRef.current === request.owner) setError(messageError(failure));
    }
  }
  function newConversation() {
    if (requestRef.current || historyBusy || unsaved) return;
    publish(owner, freshConversation(projectId));
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
      if (live.current && ownerRef.current === key) setError(messageError(failure));
    } finally {
      if (live.current) setHistoryBusy(false);
    }
  }
  async function removeConversation(id: string) {
    if (requestRef.current || historyBusy || conversations.current.isUnsaved(id)) return;
    const key = owner;
    setHistoryBusy(true);
    try {
      await deleteAssistantConversation(id);
      const visibleOwner = ownerRef.current;
      const visible = conversations.current.get(visibleOwner);
      conversations.current.remove(id);
      if (visible?.id === id) publish(visibleOwner, freshConversation(visible.projectId));
      await refreshHistory();
    } catch (failure) {
      if (live.current && ownerRef.current === key) setError(messageError(failure));
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
