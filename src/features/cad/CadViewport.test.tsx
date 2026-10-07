import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import CadViewport from './CadViewport';

const preview: CadPreview = {
  positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  triangleFaces: new Uint32Array([0]),
  edgePositions: new Float64Array(),
  edgeSegments: new Uint32Array(),
  segmentEdges: new Uint32Array(),
  faces: [
    {
      id: 'face-1',
      name: 'Face 1',
      identity: 'ambiguous',
    },
  ],
  edges: [],
  bodies: [],
};

describe('CAD inspection view controls', () => {
  it.each(['mesh', 'cad'] as const)('offers scoped face inspection in the %s view', (view) => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <CadViewport
        preview={preview}
        selected={['face-1']}
        selectionKind="body"
        onSelectionKind={noop}
        onSelect={noop}
        onClearSelection={noop}
        dark={false}
        inspection
        inspectionView={view}
        onInspectionSelect={noop}
      />,
    );
    expect(markup).toContain('aria-label="Model selection mode" disabled=""');
    expect(markup).toContain('<option value="face" selected="">Faces</option>');
    expect(markup).toContain('aria-label="Fit inspected face to view"');
    expect(markup).not.toMatch(/aria-label="Fit inspected face to view"[^>]*disabled/);
    expect(markup).toContain('Face inspected · Esc clears inspection');
    expect(markup).toContain(
      view === 'cad' ? 'CAD correspondence · exact faces' : 'Mesh inspection · boundary triangles',
    );
  });
});
