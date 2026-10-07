import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import AssistantTranscript, { scrollAssistantTranscript } from './AssistantTranscript';
import { blankProject, documentPreparation } from '../../domain/project/document';
import type { CadFeature } from '../../domain/contracts/types';

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

it('offers output-specific loft, sweep and assembly guidance without inventing an evaluation', () => {
  const features: [CadFeature, ...CadFeature[]] = [
    { id: 'box', name: 'Box', kind: 'box', length: 0.1, width: 0.05, height: 0.025 },
    {
      id: 'profile',
      name: 'Profile',
      kind: 'sketch',
      plane: 'xy',
      sketch: {
        points: [{ id: 'center', position: [0, 0] }],
        entities: [
          { id: 'circle', name: 'Circle', kind: 'circle', centerId: 'center', radius: 0.01 },
        ],
        constraints: [],
        loops: [{ id: 'outer', role: 'outer', entityIds: ['circle'] }],
      },
    },
    {
      id: 'placed',
      name: 'Placed section',
      kind: 'transform',
      inputId: 'profile',
      translation: [0, 0, 0.05],
      axisOrigin: [0, 0, 0],
      axisDirection: [0, 0, 1],
      angle: 0,
    },
    {
      id: 'path',
      name: 'Path',
      kind: 'sketch',
      plane: 'xz',
      purpose: 'path',
      sketch: {
        points: [
          { id: 'start', position: [0, 0] },
          { id: 'end', position: [0, 0.1] },
        ],
        entities: [{ id: 'line', name: 'Line', kind: 'line', startId: 'start', endId: 'end' }],
        constraints: [],
        loops: [],
      },
    },
    {
      id: 'loft',
      name: 'Loft',
      kind: 'loft',
      sectionIds: ['profile', 'placed'],
      solid: false,
      ruled: false,
    },
    {
      id: 'sweep',
      name: 'Sweep',
      kind: 'sweep',
      profileId: 'profile',
      spineId: 'path',
      solid: true,
    },
    {
      id: 'assembly',
      name: 'Assembly',
      kind: 'assembly',
      components: [{ id: 'component', name: 'Instance', featureId: 'box' }],
    },
  ];
  for (const [output, prompt] of [
    ['loft', 'Review my loft section order and placements.'],
    ['sweep', 'Explain the sweep start endpoint and required profile orientation.'],
    ['assembly', 'How do I move one component and inspect it in isolation?'],
  ]) {
    const project = {
      ...blankProject('Advanced CAD'),
      geometry: {
        kind: 'cad' as const,
        dimension: '3d' as const,
        assets: [],
        features,
        outputFeatureId: output,
      },
    };
    const html = renderToStaticMarkup(
      <AssistantTranscript
        conversation={{
          formatVersion: 1,
          id: 'advanced-chat',
          projectId: project.id,
          title: 'CAD',
          updatedAt: 0,
          messages: [],
        }}
        pending={false}
        study={{
          documentId: 'advanced-document',
          project,
          section: 'cad',
          preparation: documentPreparation(project),
          manifest: null,
          run: null,
          error: null,
          cad: {
            state: 'unevaluated',
            dimension: '3d',
            outputFeatureId: output,
            featureCount: features.length,
            sketchCount: 2,
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
    expect(html).toContain(`Let’s review your ${output}`);
    expect(html).toContain(prompt);
    expect(html).not.toContain('How do I draw a constrained sketch');
    expect(html).not.toContain('Evaluation succeeded');
    expect(html).toContain('Read-only assistance.');
  }
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
