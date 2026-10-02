import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ASSISTANT_DEFAULTS } from '../../domain/assistant/types';
import AssistantPanel, { type AssistantViewModel } from './AssistantPanel';

const session = (unsaved: boolean): AssistantViewModel => ({
  configuration: { settings: ASSISTANT_DEFAULTS.gemini, credentialPresent: true },
  conversation: {
    formatVersion: 1,
    id: 'conversation',
    projectId: null,
    title: 'Local conversation',
    updatedAt: 0,
    messages: [],
  },
  history: [],
  error: null,
  pending: false,
  historyBusy: false,
  unsaved,
  retrySave: vi.fn(async () => {}),
  restoreSaved: vi.fn(async () => {}),
  configured: vi.fn(),
  send: vi.fn(async () => false),
  stop: vi.fn(async () => {}),
  newConversation: vi.fn(),
  openConversation: vi.fn(async () => {}),
  removeConversation: vi.fn(async () => {}),
});

const markup = (model: AssistantViewModel) =>
  renderToStaticMarkup(
    <AssistantPanel
      open
      desktop
      study={null}
      session={model}
      onClose={() => {}}
      onSource={() => {}}
    />,
  );

it('identifies an unsaved transcript, offers retry, and prevents replacing it with a new chat', () => {
  const html = markup(session(true));
  expect(html).toContain('aria-label="Unsaved conversation"');
  expect(html).toContain('Conversation not saved');
  expect(html).toContain('Retry save');
  expect(html).toContain('Restore saved copy');
  expect(html).not.toContain('Discard changes and restore');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="New assistant conversation"/);
  expect(html).toContain('Retry saving before starting another conversation.');
});

it('removes the failure notice after saving and permits a new conversation', () => {
  const html = markup(session(false));
  expect(html).not.toContain('Conversation not saved');
  expect(html).not.toContain('Retry save');
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="New assistant conversation"/);
});

it('keeps context choice explicit without repeated checkbox controls', () => {
  const html = markup(session(false));
  expect(html).toContain('Help only');
  expect(html).toContain('This study');
  expect(html).not.toContain('type="checkbox"');
  expect(html).toContain('Models and providers');
  expect(html).not.toContain('Local MCP access');
});
