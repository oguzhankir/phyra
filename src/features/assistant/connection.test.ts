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
function configuration(
  settings: AssistantSettings,
  credentialPresent = true,
): AssistantConfiguration {
  return {
    settings,
    credentialPresent,
    connections: [{ settings, credentialPresent, models: [model(settings.model)] }],
  };
}
function transport() {
  return {
    storeCredential: vi.fn(async (_settings: AssistantSettings, _credential: string) => {}),
    listModels: vi.fn(async (_settings: AssistantSettings) => [model()]),
    saveConnection: vi.fn(
      async (
        settings: AssistantSettings,
        models: AssistantModel[],
      ): Promise<AssistantConfiguration> => ({
        ...configuration(settings, !settings.local),
        connections: [{ settings, credentialPresent: !settings.local, models }],
      }),
    ),
  };
}
const input = () => ({
  settings: settings(),
  configuration: null,
  credential: ' fixture-only-key ',
  models: null,
});

describe('explicit provider connection operation', () => {
  it('stores once, discovers account models, and persists the connection separately from chat selection', async () => {
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
      native.saveConnection.mock.invocationCallOrder[0],
    );
    expect(stored).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledWith([model()]);
    expect(native.saveConnection).toHaveBeenCalledWith(settings(), [model()]);
    expect(outcome.type).toBe('connected');
    expect(JSON.stringify(outcome)).not.toContain('fixture-only-key');
  });
  it('recognizes a saved connection independently of the active provider or selected model', async () => {
    const native = transport();
    const connection = configuration(settings());
    connection.settings = { ...ASSISTANT_DEFAULTS.gemini, model: 'gemini-fixture' };
    const outcome = await connectAssistantProvider(
      {
        settings: { ...settings(), model: '' },
        configuration: connection,
        credential: '',
        models: null,
      },
      native,
    );
    expect(connectionIsActive(connection, settings())).toBe(true);
    expect(outcome.type).toBe('connected');
    expect(native.storeCredential).not.toHaveBeenCalled();
    expect(native.listModels).not.toHaveBeenCalled();
    expect(native.saveConnection).toHaveBeenCalledWith(settings(), [model()]);
  });
  it('connects without a model-selection step using only a reported text model', async () => {
    const native = transport();
    native.listModels.mockResolvedValue([
      model('gpt-image-fixture'),
      model('gpt-fixture-account-model'),
    ]);
    const outcome = await connectAssistantProvider(
      { ...input(), settings: { ...settings(), model: '' } },
      native,
    );
    expect(outcome.type).toBe('connected');
    expect(native.saveConnection.mock.lastCall?.[0].model).toBe('gpt-fixture-account-model');
  });
  it('does not persist after credential failure or empty text discovery', async () => {
    const native = transport();
    native.storeCredential.mockRejectedValueOnce(new Error('Fixture OS storage failure'));
    await expect(connectAssistantProvider(input(), native)).rejects.toThrow(
      'Fixture OS storage failure',
    );
    expect(native.listModels).not.toHaveBeenCalled();
    native.listModels.mockResolvedValueOnce([model('gpt-image-fixture')]);
    await expect(connectAssistantProvider(input(), native)).rejects.toThrow('No text models');
    expect(native.saveConnection).not.toHaveBeenCalled();
  });
  it('notifies storage before a discovery failure so the saved key can be repaired', async () => {
    const native = transport();
    const stored = vi.fn();
    native.listModels.mockRejectedValueOnce(new Error('Fixture endpoint unavailable'));
    await expect(
      connectAssistantProvider({ ...input(), onCredentialStored: stored }, native),
    ).rejects.toThrow('Fixture endpoint unavailable');
    expect(stored).toHaveBeenCalledOnce();
    expect(native.saveConnection).not.toHaveBeenCalled();
  });
  it('connects a local endpoint without storing even a supplied key', async () => {
    const native = transport();
    const settings = { ...ASSISTANT_DEFAULTS.ollama, model: '' };
    native.listModels.mockResolvedValueOnce([model('fixture-local:latest')]);
    const outcome = await connectAssistantProvider({ ...input(), settings }, native);
    expect(outcome.type).toBe('connected');
    expect(native.storeCredential).not.toHaveBeenCalled();
    expect(native.listModels).toHaveBeenCalledWith(settings);
  });
  it('requires discovery after endpoint changes, a removed credential, or key replacement', async () => {
    const native = transport();
    const connection = configuration(settings());
    expect(connectionIsActive(connection, settings())).toBe(true);
    expect(connectionIsActive(configuration(settings(), false), settings())).toBe(false);
    const changed = { ...settings(), endpoint: 'https://api.openai.com/v1/fixture' };
    await connectAssistantProvider(
      { ...input(), settings: changed, configuration: connection, credential: '' },
      native,
    );
    expect(native.listModels).toHaveBeenCalledWith(changed);
    await connectAssistantProvider({ ...input(), configuration: connection }, native);
    expect(native.listModels).toHaveBeenCalledTimes(2);
  });
});
