import { describe, expect, it } from 'vitest';
import { assistantModelChoices, FEATURED_MODELS, modelLabel } from './models';
import type { AssistantModel, AssistantProvider } from './types';

const model = (id: string, name = id): AssistantModel => ({
  id,
  name,
  streaming: 'unknown',
  contextTokens: null,
  outputTokens: null,
});

describe('assistant model catalog', () => {
  it('offers verified official API IDs with readable names before connecting', () => {
    expect(FEATURED_MODELS.openai.map(({ id }) => id)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-luna',
    ]);
    expect(modelLabel('openai', 'gpt-6.1-sol')).toBe('GPT-6.1 Sol');
    expect(FEATURED_MODELS.anthropic.some(({ id }) => id === 'claude-fable-5-1')).toBe(true);
    expect(modelLabel('gemini', 'gemini-3.8-flash')).toBe('Gemini 3.8 Flash');
    expect(assistantModelChoices('openai').every(({ available }) => available === null)).toBe(true);
  });
  it('does not invent models for a user-managed or local endpoint', () => {
    expect(assistantModelChoices('compatible')).toEqual([]);
    expect(assistantModelChoices('ollama')).toEqual([]);
  });
  it('merges discovery without duplicate IDs or claiming access to catalog-only entries', () => {
    const source = [
      model('gpt-6.1-sol', 'Reported label'),
      model('gpt-fixture-new', 'New model'),
      model('gpt-fixture-new', 'New model'),
    ];
    const original = structuredClone(source);
    const choices = assistantModelChoices('openai', source);
    expect(choices.filter(({ id }) => id === 'gpt-6.1-sol')).toHaveLength(1);
    expect(choices.find(({ id }) => id === 'gpt-6.1-sol')).toMatchObject({
      name: 'GPT-6.1 Sol',
      available: true,
      featured: true,
    });
    expect(choices.find(({ id }) => id === 'gpt-6-astra')?.available).toBe(false);
    expect(choices.find(({ id }) => id === 'gpt-fixture-new')).toMatchObject({
      name: 'New model',
      available: true,
      featured: false,
    });
    expect(source).toEqual(original);
  });
  it.each([
    [
      'openai',
      [
        'text-embedding-fixture',
        'gpt-image-fixture',
        'gpt-audio-fixture',
        'gpt-realtime-fixture',
        'whisper-fixture',
        'gpt-fixture-transcribe',
        'gpt-fixture',
        'o3-fixture',
      ],
    ],
    [
      'gemini',
      [
        'gemini-fixture-image',
        'gemini-fixture-tts',
        'gemini-fixture-live',
        'gemini-fixture-audio',
        'gemini-fixture',
        'gemini-embedding-fixture',
      ],
    ],
  ] as [AssistantProvider, string[]][])(
    'excludes known non-chat model families from %s selections',
    (provider, ids) => {
      const reported = assistantModelChoices(
        provider,
        ids.map((id) => model(id)),
      )
        .filter(({ available }) => available)
        .map(({ id }) => id);
      expect(reported).toEqual(
        provider === 'openai' ? ['gpt-fixture', 'o3-fixture'] : ['gemini-fixture'],
      );
    },
  );
  it('keeps saved unknown choices visible without promoting or changing them', () => {
    expect(assistantModelChoices('ollama', null, 'local/model:tag')).toEqual([
      {
        id: 'local/model:tag',
        name: 'local/model:tag',
        detail: 'Saved model',
        tag: '',
        featured: false,
        available: null,
      },
    ]);
    expect(assistantModelChoices('ollama', [], 'local/model:tag')[0].available).toBe(false);
    expect(modelLabel('compatible', 'custom-fixture')).toBe('custom-fixture');
  });
  it('uses endpoint-reported IDs unchanged for compatible and local providers', () => {
    const models = [model('namespace/model:version', 'Local chat')];
    expect(assistantModelChoices('ollama', models)[0]).toMatchObject({
      id: 'namespace/model:version',
      name: 'Local chat',
      available: true,
    });
    expect(assistantModelChoices('compatible', models)[0].id).toBe('namespace/model:version');
  });
});
