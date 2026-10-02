import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import AssistantTranscript, { scrollAssistantTranscript } from './AssistantTranscript';

it('opens an empty conversation at the top even when the welcome content overflows', () => {
  const viewport = { scrollTop: 210, scrollHeight: 700, clientHeight: 390 };
  scrollAssistantTranscript(viewport, true);
  expect(viewport.scrollTop).toBe(0);
});

it('follows output by scrolling only the owned transcript viewport', () => {
  const outerPanel = { scrollTop: 83 };
  const viewport = {
    scrollTop: 12,
    scrollHeight: 700,
    clientHeight: 390,
    parentElement: outerPanel,
    scrollIntoView: vi.fn(() => {
      outerPanel.scrollTop = 400;
    }),
  };
  scrollAssistantTranscript(viewport, false);
  expect(viewport.scrollTop).toBe(310);
  expect(viewport.scrollIntoView).not.toHaveBeenCalled();
  expect(outerPanel.scrollTop).toBe(83);
  scrollAssistantTranscript(viewport, true);
  expect(viewport.scrollTop).toBe(0);
  expect(outerPanel.scrollTop).toBe(83);
});

it('keeps a shorter transcript at the top', () => {
  const viewport = { scrollTop: 0, scrollHeight: 110, clientHeight: 390 };
  scrollAssistantTranscript(viewport, false);
  expect(viewport.scrollTop).toBe(0);
});

it('renders the complete welcome content in an empty conversation', () => {
  const html = renderToStaticMarkup(
    <AssistantTranscript
      conversation={{
        formatVersion: 1,
        id: 'new-chat',
        projectId: null,
        title: 'New chat',
        updatedAt: 0,
        messages: [],
      }}
      pending={false}
      study={null}
      desktop={false}
      onSource={() => {}}
      onPrompt={() => {}}
      onError={() => {}}
    />,
  );
  expect(html).toContain('Engineering help');
  expect(html).toContain('How do I start a structural study?');
  expect(html).toContain('aria-label="Assistant conversation"');
});
