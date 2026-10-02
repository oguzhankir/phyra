import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ASSISTANT_DEFAULTS, type AssistantConfiguration } from '../../domain/assistant/types';
import AssistantSettingsPanel from './AssistantSettingsPanel';

const render = (configuration: AssistantConfiguration | null) =>
  renderToStaticMarkup(
    <AssistantSettingsPanel configuration={configuration} onClose={() => {}} onSaved={() => {}} />,
  );
const configured = (model = 'gemini-3.8-flash'): AssistantConfiguration => ({
  settings: { ...ASSISTANT_DEFAULTS.gemini, model },
  credentialPresent: true,
});

it('offers model cards, permanent saved-key state, and an explicit disconnect without asking for the stored key', () => {
  const html = render(configured());
  expect(html).toContain('Models &amp; connections');
  expect(html).toContain('Gemini 3.8 Flash');
  expect(html).toContain('Gemini 3.1 Pro');
  expect(html).toContain('API key saved securely');
  expect(html).toContain('Replace key');
  expect(html).toContain('Disconnect Google Gemini');
  expect(html).toContain('Use model');
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('Confirm provider disconnection');
  expect(html).not.toContain('type="checkbox"');
  expect(html).not.toContain('Assistant model ID');
  expect(html).not.toContain('Store key securely');
});
it('shows a single connect action and featured choices before setup without model ID text entry', () => {
  const html = render(null);
  expect(html).toContain('Paste your API key');
  expect(html).toContain('Saved on this device until you disconnect.');
  expect(html).toContain('Featured assistant models');
  expect(html).not.toContain('Assistant model ID');
  expect(html).not.toContain('Assistant API endpoint');
  expect(html).not.toContain('Disconnect Google Gemini');
});
it('preserves a previous discovered model as a selectable saved choice', () => {
  const html = render(configured('gemini-fixture-saved'));
  expect(html).toContain(
    '<option value="gemini-fixture-saved" selected="">gemini-fixture-saved</option>',
  );
});
it('does not offer to disconnect an already disconnected provider', () => {
  expect(render(configured(''))).not.toContain('Disconnect Google Gemini');
});
it('shows endpoint discovery for local models without a password field or guessed model names', () => {
  const html = render({ settings: ASSISTANT_DEFAULTS.ollama, credentialPresent: false });
  expect(html).toContain('No API key is needed.');
  expect(html).toContain('Assistant API endpoint');
  expect(html).toContain('Load models');
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('Featured assistant models');
});
