import { assistantModelChoices } from '../../domain/assistant/models';
import type {
  AssistantConfiguration,
  AssistantModel,
  AssistantSettings,
} from '../../domain/assistant/types';
import {
  listAssistantModels,
  saveAssistantSettings,
  storeAssistantCredential,
} from '../../platform/desktop/assistant';

interface ConnectionTransport {
  storeCredential: typeof storeAssistantCredential;
  listModels: typeof listAssistantModels;
  saveSettings: typeof saveAssistantSettings;
}
const nativeConnection: ConnectionTransport = {
  storeCredential: storeAssistantCredential,
  listModels: listAssistantModels,
  saveSettings: saveAssistantSettings,
};

export function connectionIsActive(
  configuration: AssistantConfiguration | null,
  settings: AssistantSettings,
): boolean {
  return Boolean(
    configuration?.settings.model &&
    configuration.settings.provider === settings.provider &&
    configuration.settings.endpoint === settings.endpoint &&
    (configuration.settings.local || configuration.credentialPresent),
  );
}

type ConnectionOutcome =
  | { type: 'connected'; configuration: AssistantConfiguration; models: AssistantModel[] | null }
  | { type: 'choose-model'; models: AssistantModel[] };

// One explicit action owns credential storage, account discovery and persistence.
// Keys only cross the native bridge for storage; this operation never retrieves
// keys or puts one into configuration, a model list, or its returned outcome.
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
  let models = input.models;
  // Updating a connected model does not need to read an OS key or make a new
  // provider request. A first connection loads models and checks account access.
  if (!connectionIsActive(input.configuration, settings) || newKey || !settings.model) {
    models = await transport.listModels(settings);
    input.onModelsReported?.(models);
  }
  if (models !== null) {
    const choices = assistantModelChoices(settings.provider, models);
    if (!choices.some((choice) => choice.available))
      throw new Error(
        'No text models were reported by this connection. Check your endpoint or provider access.',
      );
    if (!choices.some((choice) => choice.id === settings.model && choice.available))
      return { type: 'choose-model', models };
  }
  return {
    type: 'connected',
    configuration: await transport.saveSettings(settings),
    models,
  };
}
