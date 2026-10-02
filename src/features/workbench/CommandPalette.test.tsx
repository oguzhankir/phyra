import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CommandPalette from './CommandPalette';

describe('action search', () => {
  it('explains editor navigation and action execution next to its search', () => {
    const markup = renderToStaticMarkup(
      <CommandPalette
        commands={[
          {
            id: 'geometry',
            label: 'Geometry',
            description: 'Set the domain dimensions.',
            group: 'Prepare',
            action: () => {},
          },
          {
            id: 'run',
            label: 'Run FEM',
            description: 'Complete preparation to run.',
            group: 'Solve',
            disabled: true,
            action: () => {},
          },
        ]}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain('aria-describedby="command-description"');
    expect(markup).toContain('Jump to an editor or run a project action.');
    expect(markup).toContain('aria-label="Search actions and editors"');
    expect(markup).toContain('aria-controls="command-results"');
    expect(markup).toContain('aria-activedescendant="command-option-geometry"');
    expect(markup).toMatch(/id="command-option-run"[^>]*disabled=""/);
  });

  it('gives the Results action a distinct identity from the matching-options list', () => {
    const markup = renderToStaticMarkup(
      <CommandPalette
        commands={[
          {
            id: 'results',
            label: 'Results',
            description: 'Inspect fields.',
            group: 'Inspect',
            action: () => {},
          },
        ]}
        onClose={() => {}}
      />,
    );
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(markup).toContain('aria-activedescendant="command-option-results"');
    expect(markup).toContain('id="command-results"');
  });

  it('presents an empty catalogue without a dangling active option', () => {
    const markup = renderToStaticMarkup(<CommandPalette commands={[]} onClose={() => {}} />);
    expect(markup).toContain('No matching action.');
    expect(markup).not.toContain('aria-activedescendant=');
  });
});
