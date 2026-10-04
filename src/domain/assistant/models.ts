import type {
  AssistantConnection,
  AssistantModel,
  AssistantProvider,
  AssistantSettings,
} from './types';

/** UI identity follows the validated provider endpoint, independently of the selected model. */
export function assistantConnectionKey(settings: AssistantSettings): string {
  let endpoint = settings.endpoint.trim().replace(/\/+$/, '');
  try {
    endpoint = new URL(endpoint).toString().replace(/\/+$/, '');
  } catch {
    // Draft endpoints keep an identity until native validation provides a precise error.
  }
  return `${settings.provider}:${settings.local ? 'local' : 'remote'}:${endpoint}`;
}

export function assistantConnectionReady(connection: AssistantConnection): boolean {
  return !connection.error && (connection.settings.local || connection.credentialPresent);
}

export interface FeaturedAssistantModel {
  id: string;
  name: string;
  detail: string;
  tag: string;
}
export interface AssistantModelChoice extends FeaturedAssistantModel {
  featured: boolean;
  // A catalog is a starting point, never evidence of access on the user's account.
  available: boolean | null;
}

// Official text-model catalogs checked on 2026-10-03. Account access is discovered
// separately; do not derive API IDs from marketing names or assistant app aliases.
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://ai.google.dev/gemini-api/docs/models
export const FEATURED_MODELS: Record<AssistantProvider, readonly FeaturedAssistantModel[]> = {
  openai: [
    {
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      detail: 'Intelligence and efficiency',
      tag: 'Balanced',
    },
    {
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      detail: 'Complex reasoning and coding',
      tag: 'Flagship',
    },
    {
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      detail: 'Focused, high-volume tasks',
      tag: 'Efficient',
    },
  ],
  anthropic: [
    {
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      detail: 'Reasoning and knowledge work',
      tag: 'Flagship',
    },
    {
      id: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      detail: 'Speed and intelligence',
      tag: 'Balanced',
    },
    {
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      detail: 'Demanding reasoning',
      tag: 'Advanced',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      detail: 'Fast, focused responses',
      tag: 'Fast',
    },
  ],
  gemini: [
    {
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      detail: 'Reasoning and everyday work',
      tag: 'Balanced',
    },
    {
      id: 'gemini-3.1-pro-preview',
      name: 'Gemini 3.1 Pro',
      detail: 'Complex problem solving',
      tag: 'Preview',
    },
    {
      id: 'gemini-3.5-flash-lite',
      name: 'Gemini 3.5 Flash-Lite',
      detail: 'Fast, efficient responses',
      tag: 'Efficient',
    },
  ],
  compatible: [],
  ollama: [],
};

export function modelLabel(provider: AssistantProvider, id: string): string {
  return FEATURED_MODELS[provider].find((model) => model.id === id)?.name ?? id;
}

function supportsTextChoice(provider: AssistantProvider, id: string): boolean {
  if (provider === 'compatible' || provider === 'ollama') return true;
  const normalized = id.toLowerCase();
  if (
    /(?:image|embedding|audio|realtime|transcri|tts|moderation|deep-research|omni|live|veo|lyria|sora|dall-e)/.test(
      normalized,
    )
  )
    return false;
  if (provider === 'openai') return /^(?:gpt-|o[1-9](?:-|$)|ft:)/.test(normalized);
  if (provider === 'gemini') return normalized.startsWith('gemini-');
  return normalized.startsWith('claude-');
}

export function assistantModelChoices(
  provider: AssistantProvider,
  discovered: readonly AssistantModel[] | null = null,
  savedId = '',
): AssistantModelChoice[] {
  const reported = new Map(
    (discovered ?? [])
      .filter((model) => supportsTextChoice(provider, model.id))
      .map((model) => [model.id, model]),
  );
  const choices = FEATURED_MODELS[provider].map((model) => ({
    ...model,
    featured: true,
    available: discovered === null ? null : reported.has(model.id),
  }));
  for (const model of reported.values()) {
    if (choices.some((choice) => choice.id === model.id)) continue;
    choices.push({
      id: model.id,
      name: model.name,
      detail: 'Reported by your connection',
      tag: '',
      featured: false,
      available: true,
    });
  }
  // Keep an existing selection visible without guessing availability or replacing
  // it silently when a provider renames models or an endpoint is temporarily down.
  if (savedId && !choices.some((choice) => choice.id === savedId)) {
    choices.push({
      id: savedId,
      name: savedId,
      detail: 'Saved model',
      tag: '',
      featured: false,
      available: discovered === null ? null : false,
    });
  }
  return choices;
}
