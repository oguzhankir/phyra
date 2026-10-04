import { assistantConnectionReady, assistantModelChoices } from '../../../domain/assistant/models';
import type {
  AssistantConfiguration,
  AssistantModel,
  AssistantSettings,
} from '../../../domain/assistant/types';
import { messageError } from './conversationTurn';

interface CatalogPorts {
  current: () => boolean;
  listModels: (settings: AssistantSettings) => Promise<AssistantModel[]>;
  refresh: (
    settings: AssistantSettings,
    models: AssistantModel[],
  ) => Promise<AssistantConfiguration | null>;
  publish: (configuration: AssistantConfiguration) => void;
  error: (message: string) => void;
}

/** Restore missing account catalogs once, independently of the active chat model. */
export async function restoreConnectionCatalogs(
  configuration: AssistantConfiguration,
  ports: CatalogPorts,
): Promise<void> {
  for (const connection of configuration.connections) {
    if (!ports.current()) return;
    if (!assistantConnectionReady(connection) || connection.models.length) continue;
    try {
      const models = await ports.listModels({ ...connection.settings });
      if (!ports.current()) return;
      const choices = assistantModelChoices(connection.settings.provider, models).filter(
        (model) => model.available,
      );
      if (!choices.length)
        throw new Error('No text models were reported. Check the connection or provider access.');
      const settings = {
        ...connection.settings,
        model: connection.settings.model || choices[0].id,
      };
      const refreshed = await ports.refresh(settings, models);
      if (ports.current() && refreshed) ports.publish(refreshed);
    } catch (failure) {
      if (ports.current()) ports.error(`${connection.settings.provider}: ${messageError(failure)}`);
    }
  }
}
