import { describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_DEFAULTS,
  type AssistantConfiguration,
  type AssistantModel,
  type AssistantSettings,
} from '../../../domain/assistant/types';
import { restoreConnectionCatalogs } from './providerCatalogs';

const model = (id: string): AssistantModel => ({
  id,
  name: id,
  streaming: 'unknown',
  contextTokens: null,
  outputTokens: null,
});
function configuration(): AssistantConfiguration {
  return {
    settings: { ...ASSISTANT_DEFAULTS.gemini, model: 'gemini-fixture' },
    credentialPresent: true,
    connections: [
      { settings: { ...ASSISTANT_DEFAULTS.gemini }, credentialPresent: true, models: [] },
      { settings: { ...ASSISTANT_DEFAULTS.openai }, credentialPresent: true, models: [] },
    ],
  };
}
function ports(value: AssistantConfiguration) {
  return {
    current: () => true,
    listModels: vi.fn(async (settings: AssistantSettings) => [
      model(`${settings.provider}-fixture`),
    ]),
    refresh: vi.fn(async (_settings: AssistantSettings, _models: AssistantModel[]) => value),
    publish: vi.fn(),
    error: vi.fn(),
  };
}

describe('restoring connected-provider catalogs', () => {
  it('discovers each missing catalog even when the active model changes between providers', async () => {
    const value = configuration();
    const callbacks = ports(value);
    callbacks.listModels.mockImplementation(async (settings) => {
      if (settings.provider === 'openai') value.settings.model = 'gemini-selected-during-discovery';
      return [model(settings.provider === 'openai' ? 'gpt-fixture' : 'gemini-fixture')];
    });
    await restoreConnectionCatalogs(value, callbacks);
    expect(callbacks.listModels).toHaveBeenCalledTimes(2);
    expect(callbacks.refresh).toHaveBeenCalledTimes(2);
    expect(callbacks.refresh.mock.calls[1][0].model).toBe('gpt-fixture');
    expect(callbacks.publish.mock.lastCall?.[0].settings.model).toBe(
      'gemini-selected-during-discovery',
    );
    expect(callbacks.error).not.toHaveBeenCalled();
  });
  it('keeps a failed provider repairable while restoring the next provider', async () => {
    const value = configuration();
    const callbacks = ports(value);
    callbacks.listModels.mockRejectedValueOnce(new Error('Fixture connection unavailable'));
    callbacks.listModels.mockResolvedValueOnce([model('gpt-fixture')]);
    await restoreConnectionCatalogs(value, callbacks);
    expect(callbacks.error).toHaveBeenCalledWith('gemini: Fixture connection unavailable');
    expect(callbacks.refresh).toHaveBeenCalledOnce();
    expect(value.connections).toHaveLength(2);
  });
  it('does not persist or publish a late discovery after the session closes', async () => {
    const value = configuration();
    const callbacks = ports(value);
    let live = true;
    callbacks.current = () => live;
    callbacks.listModels.mockImplementationOnce(async () => {
      live = false;
      return [model('gemini-fixture')];
    });
    await restoreConnectionCatalogs(value, callbacks);
    expect(callbacks.refresh).not.toHaveBeenCalled();
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(callbacks.listModels).toHaveBeenCalledOnce();
  });
  it('skips cached models and connections with unavailable credentials', async () => {
    const value = configuration();
    value.connections[0].models = [model('gemini-fixture')];
    value.connections[1].credentialPresent = false;
    value.connections[1].error = 'OS credential access is unavailable';
    const callbacks = ports(value);
    await restoreConnectionCatalogs(value, callbacks);
    expect(callbacks.listModels).not.toHaveBeenCalled();
  });
  it('filters image models before initializing an otherwise empty chat selection', async () => {
    const value = configuration();
    value.connections.shift();
    const callbacks = ports(value);
    callbacks.listModels.mockResolvedValueOnce([
      model('gpt-image-fixture'),
      model('gpt-text-fixture'),
    ]);
    await restoreConnectionCatalogs(value, callbacks);
    expect(callbacks.refresh.mock.calls[0][0].model).toBe('gpt-text-fixture');
  });
});
