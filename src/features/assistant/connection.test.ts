import { describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_DEFAULTS,
  type AssistantConfiguration,
  type AssistantModel,
  type AssistantSettings,
} from '../../domain/assistant/types';
import { connectAssistantProvider, connectionIsActive } from './connection';

const settings = (): AssistantSettings => ({ ...ASSISTANT_DEFAULTS.openai, model: 'gpt-6.1-sol' });
const model = (id = 'gpt-6.1-sol'): AssistantModel => ({
  id,
  name: id,
  streaming: 'supported',
  contextTokens: null,
  outputTokens: null,
});
function transport() {
  return {
    storeCredential: vi.fn(async (_settings: AssistantSettings, _credential: string) => {}),
    listModels: vi.fn(async (_settings: AssistantSettings) => [model()]),
    saveSettings: vi.fn(async (settings: AssistantSettings): Promise<AssistantConfiguration> => ({
      settings,
      credentialPresent: !settings.local,
    })),
  };
}
const input = () => ({
  settings: settings(),
  configuration: null,
  credential: ' fixture-only-key ',
  models: null,
});

describe('explicit provider connection operation', () => {
  it('stores once, discovers account models, and then persists the chosen connection', async () => {
    const native = transport();
    const stored = vi.fn(),
      reported = vi.fn();
    const outcome = await connectAssistantProvider(
      { ...input(), onCredentialStored: stored, onModelsReported: reported },
      native,
    );
    expect(native.storeCredential).toHaveBeenCalledWith(settings(), 'fixture-only-key');
    expect(native.storeCredential.mock.invocationCallOrder[0]).toBeLessThan(
      native.listModels.mock.invocationCallOrder[0],
    );
    expect(native.listModels.mock.invocationCallOrder[0]).toBeLessThan(
      native.saveSettings.mock.invocationCallOrder[0],
    );
    expect(stored).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledWith([model()]);
    expect(outcome.type).toBe('connected');
    expect(JSON.stringify(outcome)).not.toContain('fixture-only-key');
  });
  it('changes the selected model on an existing connection without loading an OS key or making provider requests', async () => {
    const native = transport();
    const chosen = { ...settings(), model: 'gpt-6-astra' };
    const configuration = { settings: settings(), credentialPresent: true };
    const outcome = await connectAssistantProvider(
      { settings: chosen, configuration, credential: '', models: null },
      native,
    );
    expect(outcome.type).toBe('connected');
    expect(native.storeCredential).not.toHaveBeenCalled();
    expect(native.listModels).not.toHaveBeenCalled();
    expect(native.saveSettings).toHaveBeenCalledWith(chosen);
  });
  it('keeps unavailable catalog selections for a user choice instead of silently swapping models', async () => {
    const native = transport();
    native.listModels.mockResolvedValue([model('gpt-fixture-account-model')]);
    const outcome = await connectAssistantProvider(input(), native);
    expect(outcome).toMatchObject({ type: 'choose-model' });
    expect(native.saveSettings).not.toHaveBeenCalled();
  });
  it('does not persist a connection after credential failure or empty text discovery', async () => {
    const native = transport();
    native.storeCredential.mockRejectedValueOnce(new Error('Fixture OS storage failure'));
    await expect(connectAssistantProvider(input(), native)).rejects.toThrow(
      'Fixture OS storage failure',
    );
    expect(native.listModels).not.toHaveBeenCalled();
    native.listModels.mockResolvedValueOnce([model('gpt-image-fixture')]);
    await expect(connectAssistantProvider(input(), native)).rejects.toThrow('No text models');
    expect(native.saveSettings).not.toHaveBeenCalled();
  });
  it('connects a local endpoint without storing even a supplied key', async () => {
    const native = transport();
    const settings = { ...ASSISTANT_DEFAULTS.ollama, model: 'fixture-local:latest' };
    native.listModels.mockResolvedValueOnce([model(settings.model)]);
    const outcome = await connectAssistantProvider({ ...input(), settings }, native);
    expect(outcome.type).toBe('connected');
    expect(native.storeCredential).not.toHaveBeenCalled();
    expect(native.listModels).toHaveBeenCalledWith(settings);
  });
  it('requires discovery again after endpoint/provider changes or key replacement', async () => {
    const native = transport();
    const configuration = { settings: settings(), credentialPresent: true };
    expect(connectionIsActive(configuration, settings())).toBe(true);
    expect(connectionIsActive({ ...configuration, credentialPresent: false }, settings())).toBe(
      false,
    );
    const changed = { ...settings(), endpoint: 'https://api.openai.com/v1/fixture' };
    await connectAssistantProvider(
      { ...input(), settings: changed, configuration, credential: '' },
      native,
    );
    expect(native.listModels).toHaveBeenCalledWith(changed);
    await connectAssistantProvider({ ...input(), configuration }, native);
    expect(native.listModels).toHaveBeenCalledTimes(2);
  });
});
