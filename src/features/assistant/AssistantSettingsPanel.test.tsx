import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ASSISTANT_DEFAULTS } from '../../domain/assistant/types';
import AssistantSettingsPanel from './AssistantSettingsPanel';

const render = (model: string) =>
  renderToStaticMarkup(
    <AssistantSettingsPanel
      configuration={{ settings: { ...ASSISTANT_DEFAULTS.gemini, model }, credentialPresent: true }}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

it('describes persistent storage and exposes an explicit active-provider disconnect', () => {
  const html = render('fixture-model');
  expect(html).toContain('Closing Phyra does not disconnect it.');
  expect(html).toContain('Disconnect Google Gemini');
  expect(html).not.toContain('Confirm provider disconnection');
});
it('does not offer to disconnect an already disconnected provider', () => {
  expect(render('')).not.toContain('Disconnect Google Gemini');
});
