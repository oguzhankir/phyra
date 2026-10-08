import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProjectWorkspaceBar from './ProjectWorkspaceBar';

const defaults = {
  path: '/projects/bracket.phyra',
  dirty: false,
  desktop: true,
  canSave: true,
  autosaveEnabled: true,
  autosaveStatus: 'saved' as const,
  autosaveError: null,
  onAutosave: () => {},
  onSave: () => {},
  compact: true,
};

describe('compact document persistence', () => {
  it('keeps saved state explicit and prevents saving an unchanged file', () => {
    const markup = renderToStaticMarkup(<ProjectWorkspaceBar {...defaults} />);
    expect(markup).toMatch(/role="status"[^>]*>.*Saved<\/div>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Save project"/);
    expect(markup.match(/aria-label="Save project"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Save options"');
  });

  it('identifies a draft and keeps its save action available', () => {
    const markup = renderToStaticMarkup(
      <ProjectWorkspaceBar {...defaults} path={null} dirty autosaveStatus="needs-save" />,
    );
    expect(markup).toContain('>Draft</div>');
    expect(markup).toMatch(/<button class="primary" aria-label="Save project"/);
    expect(markup).not.toContain('>Saved</div>');
  });

  it('shows failure without losing manual save or the supplied error detail', () => {
    const markup = renderToStaticMarkup(
      <ProjectWorkspaceBar
        {...defaults}
        dirty
        autosaveStatus="error"
        autosaveError="The project file is read-only."
      />,
    );
    expect(markup).toContain('role="status" title="The project file is read-only."');
    expect(markup).toContain('Save failed</div>');
    expect(markup).toMatch(/<button class="secondary" aria-label="Save project"/);
    expect(markup).not.toContain('>Saved</div>');
  });
});
