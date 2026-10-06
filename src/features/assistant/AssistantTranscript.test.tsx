import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import AssistantTranscript, { scrollAssistantTranscript } from './AssistantTranscript';
import { blankProject, documentPreparation } from '../../domain/project/document';

it('opens an empty conversation at the top even when the welcome content overflows', () => {
  const viewport = { scrollTop: 210, scrollHeight: 700, clientHeight: 390 };
  scrollAssistantTranscript(viewport, true);
  expect(viewport.scrollTop).toBe(0);
});

it('offers actionable CAD prompts before a project has an analysis study', () => {
  const project = blankProject('Blank CAD', '3d');
  const html = renderToStaticMarkup(
    <AssistantTranscript
      conversation={{
        formatVersion: 1,
        id: 'cad-chat',
        projectId: project.id,
        title: 'CAD',
        updatedAt: 0,
        messages: [],
      }}
      pending={false}
      study={{
        documentId: 'cad-document',
        project,
        section: 'cad',
        preparation: documentPreparation(project),
        manifest: null,
        run: null,
        error: null,
        cad: {
          state: 'unevaluated',
          dimension: '3d',
          outputFeatureId: null,
          featureCount: 0,
          sketchCount: 0,
          assetCount: 0,
          evaluation: null,
        },
      }}
      desktop={false}
      onSource={() => {}}
      onPrompt={() => {}}
      onError={() => {}}
    />,
  );
  expect(html).toContain('Let’s build your geometry');
  expect(html).toContain('draw a constrained sketch');
  expect(html).toContain('selected CAD output support for analysis');
  expect(html).not.toContain('Explain the governing equations for this study.');
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
  expect(html).toContain('Your engineering assistant');
  expect(html).toContain('How do I start a structural study?');
  expect(html).toContain('aria-label="Assistant conversation"');
});
