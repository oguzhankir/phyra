import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ASSISTANT_DEFAULTS, type AssistantConfiguration } from '../../domain/assistant/types';
import AssistantSettingsPanel from './AssistantSettingsPanel';

const render = (configuration: AssistantConfiguration | null) =>
  renderToStaticMarkup(
    <AssistantSettingsPanel configuration={configuration} onClose={() => {}} onSaved={() => {}} />,
  );
const settings = { ...ASSISTANT_DEFAULTS.gemini, model: 'gemini-fixture' };
const configured: AssistantConfiguration = {
  settings,
  credentialPresent: true,
  connections: [
    { settings, credentialPresent: true, models: [] },
    {
      settings: { ...ASSISTANT_DEFAULTS.openai, model: 'gpt-fixture' },
      credentialPresent: true,
      models: [],
    },
  ],
};
it('shows every connected provider without exposing model selection in connection settings', () => {
  const html = render(configured);
  expect(html).toContain('AI connections');
  expect(html.match(/aria-label="Connected"/g)).toHaveLength(2);
  expect(html).toContain('API key saved securely');
  expect(html).toContain('Replace key');
  expect(html).toContain('Disconnect Google Gemini');
  expect(html).toContain('Test connection');
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('gemini-fixture');
  expect(html).not.toContain('Featured assistant models');
  expect(html).not.toContain('<select');
});
it('offers one connection action and explains what a deliberate send supplies', () => {
  const html = render(null);
  expect(html).toContain('Paste your API key');
  expect(html).toContain(
    'Messages and the active project are sent to the provider you choose when you send a message.',
  );
  expect(html).not.toContain('Assistant API endpoint');
  expect(html).not.toContain('Disconnect Google Gemini');
  expect(html.match(/Not connected/g)).toHaveLength(6);
});
it('shows a local endpoint without asking for a key', () => {
  const html = render({
    settings: ASSISTANT_DEFAULTS.ollama,
    credentialPresent: false,
    connections: [],
  });
  expect(html).toContain('No API key is needed.');
  expect(html).toContain('Assistant API endpoint');
  expect(html).not.toContain('type="password"');
});
it('identifies a saved connection whose credential is absent as not connected', () => {
  const html = render({
    ...configured,
    credentialPresent: false,
    connections: [{ settings, credentialPresent: false, models: [] }],
  });
  expect(html).toContain('Paste your API key');
  expect(html).toContain('Disconnect Google Gemini');
});
