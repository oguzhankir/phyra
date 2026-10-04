import { expect, it } from 'vitest';
import {
  ASSISTANT_DEFAULTS,
  type AssistantConfiguration,
  type AssistantSettings,
} from '../../domain/assistant/types';
import { chatModelChoices, chatModelKey } from './chatModels';
import { conversationDateGroup, conversationHistoryGroups } from './AssistantHistory';
const model = (id: string) => ({
  id,
  name: id,
  streaming: 'unknown' as const,
  contextTokens: null,
  outputTokens: null,
});
const gemini = { ...ASSISTANT_DEFAULTS.gemini, model: 'gemini-fixture' };
const openai = { ...ASSISTANT_DEFAULTS.openai, model: 'gpt-fixture' };
const config: AssistantConfiguration = {
  settings: gemini,
  credentialPresent: true,
  connections: [
    { settings: gemini, credentialPresent: true, models: [model('gemini-fixture')] },
    {
      settings: openai,
      credentialPresent: true,
      models: [model('gpt-fixture'), model('image-fixture')],
    },
  ],
};
it('offers discovered text models across all ready connections and excludes guessed/unavailable entries', () => {
  const choices = chatModelChoices(config);
  expect(choices.map((choice) => choice.label)).toEqual(['gemini-fixture', 'gpt-fixture']);
  expect(choices.map((choice) => choice.group)).toEqual(['Google Gemini', 'OpenAI']);
  expect(choices[1].settings).toEqual(openai);
  expect(
    chatModelChoices({
      ...config,
      connections: [{ ...config.connections[1], credentialPresent: false }],
    }),
  ).toEqual([]);
});
it('keeps same model IDs on distinct compatible endpoints independently selectable', () => {
  const settings: AssistantSettings = {
    provider: 'compatible',
    endpoint: 'https://first.example/v1',
    local: false,
    model: 'shared',
  };
  const second = { ...settings, endpoint: 'https://first.example/v2' };
  const choices = chatModelChoices({
    ...config,
    connections: [settings, second].map((value) => ({
      settings: value,
      credentialPresent: true,
      models: [model('shared')],
    })),
  });
  expect(choices).toHaveLength(2);
  expect(chatModelKey(settings)).not.toBe(chatModelKey(second));
  expect(choices[0].group).not.toBe(choices[1].group);
});
it('groups history by local calendar boundaries and searches without mutating storage order', () => {
  const now = new Date(2026, 9, 4, 14).getTime();
  expect(conversationDateGroup(new Date(2026, 9, 4, 0).getTime(), now)).toBe('Today');
  expect(conversationDateGroup(new Date(2026, 9, 3, 23).getTime(), now)).toBe('Yesterday');
  expect(conversationDateGroup(new Date(2026, 8, 25).getTime(), now)).toBe('Earlier');
  const history = [
    {
      id: 'old',
      projectId: null,
      title: 'Beam setup',
      updatedAt: now - 9 * 86400000,
      messageCount: 2,
    },
    { id: 'new', projectId: null, title: 'Beam results', updatedAt: now, messageCount: 4 },
  ];
  expect(conversationHistoryGroups(history, ' beam ', now).map(([name]) => name)).toEqual([
    'Today',
    'Earlier',
  ]);
  expect(history[0].id).toBe('old');
  expect(conversationHistoryGroups(history, 'missing', now)).toEqual([]);
});

it('keeps a saved active label visible while its discovered catalog is unavailable', () => {
  const choices = chatModelChoices({
    ...config,
    connections: [{ ...config.connections[0], models: [] }],
  });
  expect(choices).toHaveLength(1);
  expect(choices[0]).toMatchObject({ label: 'gemini-fixture', disabled: true });
});
