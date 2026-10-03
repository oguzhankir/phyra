import { Network } from 'lucide-react';
import type { AssistantProvider } from '../../domain/assistant/types';

export const providerNames: Record<AssistantProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  compatible: 'OpenAI-compatible',
  ollama: 'Ollama',
};
export function ProviderLogo({ provider }: { provider: AssistantProvider }) {
  if (provider === 'compatible') return <Network size={20} aria-hidden="true" />;
  return (
    <img
      className={`provider-logo ${provider === 'gemini' ? 'color' : 'mono'}`}
      src={`/providers/${provider === 'gemini' ? 'gemini-color' : provider}.svg`}
      alt=""
      width="20"
      height="20"
    />
  );
}
