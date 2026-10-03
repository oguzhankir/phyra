import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeProject } from '../examples/projects';
import ModelTree from './ModelTree';

describe('model object navigation', () => {
  it('keeps physical objects available when inspecting results and scopes group IDs to the document', () => {
    const project = makeProject('cantilever');
    const action = () => {};
    const render = (documentId: string) =>
      renderToStaticMarkup(
        <ModelTree
          documentId={documentId}
          project={project}
          section="results"
          constraintId={null}
          loadId={null}
          namedSelectionId={null}
          hasSelection={false}
          locked={false}
          solved={true}
          stale={false}
          onSection={action}
          onAddSupport={action}
          onAddLoad={action}
          onAddSelection={action}
        />,
      );
    const first = render('first');
    expect(first).toContain('aria-label="Model objects"');
    expect(first).toContain(project.study.constraints[0].name);
    expect(first).toContain(project.study.loads[0].name);
    expect(first).toContain('aria-label="Actions for Geometry"');
    expect(first).toContain('aria-controls="model-first-loads"');
    expect(first).toContain('id="model-first-loads"');
    expect(first).not.toContain('hidden=""');
    expect(first.match(/aria-current="page"/g)).toHaveLength(1);
    expect(render('second')).toContain('aria-controls="model-second-loads"');
  });
});
