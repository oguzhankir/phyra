import {
  assistantConnectionKey,
  assistantConnectionReady,
  assistantModelChoices,
} from '../../domain/assistant/models';
import type {
  AssistantConfiguration,
  AssistantModel,
  AssistantSettings,
} from '../../domain/assistant/types';
import {
  listAssistantModels,
  saveAssistantConnection,
  storeAssistantCredential,
} from '../../platform/desktop/assistant';

interface ConnectionTransport {
  storeCredential: typeof storeAssistantCredential;
  listModels: typeof listAssistantModels;
  saveConnection: typeof saveAssistantConnection;
}
const nativeConnection: ConnectionTransport = {
  storeCredential: storeAssistantCredential,
  listModels: listAssistantModels,
  saveConnection: saveAssistantConnection,
};

export function connectionIsActive(
  configuration: AssistantConfiguration | null,
  settings: AssistantSettings,
): boolean {
  return Boolean(
    configuration?.connections.some(
      (connection) =>
        assistantConnectionKey(connection.settings) === assistantConnectionKey(settings) &&
        assistantConnectionReady(connection),
    ),
  );
}

type ConnectionOutcome = {
  type: 'connected';
  configuration: AssistantConfiguration;
  models: AssistantModel[];
};

// One explicit action owns credential storage, account discovery and persistence.
// Keys cross the native bridge only for OS storage and never enter returned state.
export async function connectAssistantProvider(
  input: {
    settings: AssistantSettings;
    configuration: AssistantConfiguration | null;
    credential: string;
    models: AssistantModel[] | null;
    onCredentialStored?: () => void;
    onModelsReported?: (models: AssistantModel[]) => void;
  },
  transport: ConnectionTransport = nativeConnection,
): Promise<ConnectionOutcome> {
  const settings = { ...input.settings };
  const newKey = !settings.local && Boolean(input.credential.trim());
  if (newKey) {
    await transport.storeCredential(settings, input.credential.trim());
    input.onCredentialStored?.();
  }
  const existing = input.configuration?.connections.find(
    (connection) =>
      assistantConnectionKey(connection.settings) === assistantConnectionKey(settings),
  );
  let models = input.models ?? existing?.models ?? [];
  if (!connectionIsActive(input.configuration, settings) || newKey || !models.length) {
    models = await transport.listModels(settings);
    input.onModelsReported?.(models);
  }
  const choices = assistantModelChoices(settings.provider, models).filter(
    (choice) => choice.available,
  );
  if (!choices.length)
    throw new Error(
      'No text models were reported by this connection. Check your endpoint or provider access.',
    );
  // Connections do not ask users to choose a model. Preserve their saved choice
  // where available; the first reported text model initializes a new connection.
  const preferred = settings.model || existing?.settings.model;
  const selected = {
    ...settings,
    model: choices.find((choice) => choice.id === preferred)?.id ?? choices[0].id,
  };
  return {
    type: 'connected',
    configuration: await transport.saveConnection(selected, models),
    models,
  };
}
