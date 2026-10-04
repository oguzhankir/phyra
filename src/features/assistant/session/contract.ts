import type {
  AssistantConfiguration,
  AssistantContext,
  AssistantConversation,
  AssistantConversationSummary,
  AssistantSettings,
} from '../../../domain/assistant/types';

/** The chat UI consumes this contract without owning transport or document lifecycle. */
export interface AssistantViewModel {
  configuration: AssistantConfiguration | null;
  conversation: AssistantConversation;
  history: AssistantConversationSummary[];
  error: string | null;
  pending: boolean;
  historyBusy: boolean;
  unsaved: boolean;
  retrySave: () => Promise<void>;
  restoreSaved: () => Promise<void>;
  configured: (configuration: AssistantConfiguration) => void;
  selectModel: (settings: AssistantSettings) => Promise<void>;
  refreshModels: (settings: AssistantSettings) => Promise<void>;
  send: (
    question: string,
    context: AssistantContext,
    allowRemote: boolean,
    onAccepted?: () => void,
  ) => Promise<boolean>;
  stop: () => Promise<void>;
  newConversation: () => void;
  openConversation: (id: string) => Promise<boolean>;
  removeConversation: (id: string) => Promise<void>;
}

/** The host supplies identity, never a solver session, file path or bulk result buffer. */
export interface AssistantSessionHost {
  owner: string;
  projectId: string | null;
  desktop: boolean;
}
