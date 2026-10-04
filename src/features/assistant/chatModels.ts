import {
  assistantConnectionKey,
  assistantModelChoices,
  modelLabel,
} from '../../domain/assistant/models';
import type { AssistantConfiguration, AssistantSettings } from '../../domain/assistant/types';
import { providerNames } from './providers';

export const chatModelKey = (settings: AssistantSettings) =>
  JSON.stringify([settings.provider, settings.endpoint, settings.local, settings.model]);

/** Only the connected account's reported text models belong in the chat menu. */
export function chatModelChoices(configuration: AssistantConfiguration | null) {
  const choices = (configuration?.connections ?? []).flatMap((connection) => {
    if (!connection.settings.local && !connection.credentialPresent) return [];
    const label = providerNames[connection.settings.provider];
    const siblings = configuration!.connections.filter(
      (item) => item.settings.provider === connection.settings.provider,
    );
    const group =
      siblings.length > 1
        ? `${label} · ${new URL(connection.settings.endpoint).host}${new URL(connection.settings.endpoint).pathname.replace(/\/$/, '')}`
        : label;
    return assistantModelChoices(connection.settings.provider, connection.models)
      .filter((model) => model.available)
      .map((model) => {
        const settings = { ...connection.settings, model: model.id };
        return {
          value: chatModelKey(settings),
          label: model.name,
          group,
          settings,
          disabled: false,
        };
      });
  });
  const active = configuration?.settings;
  if (
    active?.model &&
    configuration?.connections.some(
      (connection) =>
        assistantConnectionKey(connection.settings) === assistantConnectionKey(active) &&
        (connection.settings.local || connection.credentialPresent),
    ) &&
    !choices.some((choice) => choice.value === chatModelKey(active))
  ) {
    choices.push({
      value: chatModelKey(active),
      label: modelLabel(active.provider, active.model),
      group: providerNames[active.provider],
      settings: active,
      disabled: true,
    });
  }
  return choices;
}
