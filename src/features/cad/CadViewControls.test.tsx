import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CadViewControls from './CadViewControls';

describe('read-only CAD view controls', () => {
  it('disables topology actions while preserving camera and display controls', () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <CadViewControls
        selectionKind="face"
        canSelect={false}
        hasBodies={false}
        onSelectionKind={noop}
        view="custom"
        onView={noop}
        onFit={noop}
        canFitSelection={false}
        onFitSelection={noop}
        style="wireframe"
        onStyle={noop}
      />,
    );
    expect(markup).toContain('aria-label="Model selection mode" disabled=""');
    expect(markup).toMatch(/aria-label="Fit selected CAD entities to view"[^>]*disabled=""/);
    expect(markup).toContain('<select aria-label="CAD standard view"');
    expect(markup).toContain('<option value="custom" disabled="" selected="">Custom view');
    expect(markup).toContain('<option value="wireframe" selected="">Wireframe');
    expect(markup).toMatch(/<button aria-label="Fit CAD model to view"[^>]*>/);
  });
});
