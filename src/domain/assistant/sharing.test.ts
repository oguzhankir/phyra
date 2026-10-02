import { expect, it } from 'vitest';
import { ASSISTANT_DEFAULTS, type AssistantContext, type AssistantConversation } from './types';
import { previouslyApproved, sharingIdentity, sharingScope } from './sharing';
const help: AssistantContext = {
  kind: 'help',
  projectId: null,
  studyId: null,
  revision: null,
  sourceIds: [],
  text: 'Offline help',
};
const conversation: AssistantConversation = {
  formatVersion: 1,
  id: 'chat',
  projectId: 'project',
  title: 'Chat',
  updatedAt: 1,
  messages: [],
};
const settings = {
  ...ASSISTANT_DEFAULTS.compatible,
  endpoint: 'https://fixture.example/v1',
  model: 'fixture',
};
const approved = {
  ...conversation,
  messages: [
    {
      id: 'turn',
      role: 'user' as const,
      content: 'Explain this',
      status: 'complete' as const,
      createdAt: 1,
      provider: settings.provider,
      endpoint: settings.endpoint,
      local: false,
      remoteAllowed: true,
      context: help,
    },
  ],
};
it('continues approved chat at the same origin without authorizing another provider or study', () => {
  expect(
    previouslyApproved(
      approved,
      { ...settings, model: 'other', endpoint: 'https://fixture.example/v2' },
      'help',
    ),
  ).toBe(true);
  expect(
    previouslyApproved(approved, { ...settings, endpoint: 'https://other.example/v1' }, 'help'),
  ).toBe(false);
  expect(previouslyApproved(approved, { ...settings, provider: 'openai' }, 'help')).toBe(false);
  expect(previouslyApproved(approved, settings, 'study')).toBe(false);
  expect(
    previouslyApproved(
      { ...approved, messages: [{ ...approved.messages[0], remoteAllowed: false }] },
      settings,
      'help',
    ),
  ).toBe(false);
});
it('keeps private earlier turns in the sharing disclosure even when current context is help only', () => {
  const study = {
    ...help,
    kind: 'study' as const,
    projectId: 'project',
    studyId: 'study',
    revision: 3,
  };
  const prior = { ...approved, messages: [{ ...approved.messages[0], context: study }] };
  expect(sharingScope(prior, help)).toBe('study');
  expect(previouslyApproved(prior, settings, 'study')).toBe(true);
  expect(sharingIdentity(prior, settings, 'study')).not.toBe(
    sharingIdentity({ ...prior, id: 'new' }, settings, 'study'),
  );
});
