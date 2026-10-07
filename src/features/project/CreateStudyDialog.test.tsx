import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CreateStudyDialog from './CreateStudyDialog';
import { makeProject } from '../examples/projects';

function markup(replacing: boolean) {
  return renderToStaticMarkup(
    <CreateStudyDialog
      dimension="3d"
      units="mm"
      defaultSize={0.01}
      previousStudy={replacing ? makeProject().study : null}
      replacing={replacing}
      locked={false}
      onCancel={() => {}}
      onCreate={() => {}}
    />,
  );
}

describe('source-bound study preparation dialog', () => {
  it('shows explicit material inputs, displayed mesh units and implemented material limits', () => {
    const html = markup(false);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Target mesh size · mm');
    expect(html).toContain('value="10"');
    expect(html).toContain('at most 0.45');
    expect(html).toContain('Create study');
    expect(html).toContain('disabled=""');
  });
  it('makes clearing old assignments explicit when recreating a changed CAD source', () => {
    const html = markup(true);
    expect(html).toContain('Recreate study and clear assignments');
    expect(html).toContain('Existing supports and loads will be cleared');
    expect(html).toContain('Undo restores the previous study');
  });
});
