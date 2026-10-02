import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkbenchHeader from './WorkbenchHeader';

function header() {
  const action = () => {};
  return renderToStaticMarkup(
    <WorkbenchHeader
      hasProject
      canClose
      locked={false}
      canUseFiles
      canSave
      canExport
      preference="light"
      onTheme={action}
      onNew={action}
      onOpen={action}
      onClose={action}
      onSave={action}
      onExport={action}
      onHelp={action}
      onFilesHelp={action}
      canUndo={false}
      canRedo={false}
      undoLabel=""
      redoLabel=""
      onUndo={action}
      onRedo={action}
      onCommands={action}
      onAssistantOpen={action}
    />,
  );
}

describe('workbench navigation', () => {
  it('offers one global help entry with a keyboard shortcut', () => {
    const markup = header();
    expect(markup.match(/aria-label="Open workbench help"/g)).toHaveLength(1);
    expect(markup).toContain('Workbench help · F1');
    expect(markup).not.toContain('Project file help');
  });

  it('identifies action search and uses an accessible icon for chat', () => {
    const markup = header();
    expect(markup).toContain('Search actions');
    expect(markup).toContain('<kbd>⌘/Ctrl K</kbd>');
    expect(markup).not.toContain('>Commands<');
    expect(markup).toMatch(
      /<button[^>]*class="assistant-launcher"[^>]*aria-label="Open AI assistant"[^>]*><svg/,
    );
    expect(markup).toContain('Open chat · Ctrl/⌘ J');
    expect(markup).not.toContain('>Assistant<');
  });
});
