import { Focus, Maximize, MousePointer2 } from 'lucide-react';

export type CadStandardView = 'iso' | 'front' | 'top' | 'right';
export type CadDisplayStyle = 'edges' | 'shaded' | 'wireframe';

export default function CadViewControls({
  selectionKind,
  canSelect,
  hasBodies,
  onSelectionKind,
  view,
  onView,
  onFit,
  canFitSelection,
  inspection = false,
  onFitSelection,
  style,
  onStyle,
}: {
  selectionKind: 'face' | 'edge' | 'body';
  canSelect: boolean;
  hasBodies: boolean;
  onSelectionKind: (kind: 'face' | 'edge' | 'body') => void;
  view: CadStandardView | 'custom';
  onView: (view: CadStandardView) => void;
  onFit: () => void;
  canFitSelection: boolean;
  inspection?: boolean;
  onFitSelection: () => void;
  style: CadDisplayStyle;
  onStyle: (style: CadDisplayStyle) => void;
}) {
  return (
    <div className="cad-model-tools" role="toolbar" aria-label="Model view controls">
      <div className="cad-view-group">
        <MousePointer2 size={14} aria-hidden="true" />
        <select
          aria-label="Model selection mode"
          value={selectionKind}
          disabled={!canSelect}
          onChange={(event) => onSelectionKind(event.target.value as typeof selectionKind)}
        >
          <option value="face">Faces</option>
          <option value="edge">Edges</option>
          <option value="body" disabled={!hasBodies}>
            Bodies
          </option>
        </select>
      </div>
      <div className="cad-view-group">
        <select
          aria-label="CAD standard view"
          value={view}
          title="Standard views · 1 Isometric, 2 Front, 3 Top, 4 Right"
          onChange={(event) => onView(event.target.value as CadStandardView)}
        >
          {view === 'custom' && (
            <option value="custom" disabled>
              Custom view
            </option>
          )}
          <option value="iso">Isometric</option>
          <option value="front">Front · XY</option>
          <option value="top">Top · XZ</option>
          <option value="right">Right · YZ</option>
        </select>
        <button
          aria-label="Fit CAD model to view"
          title="Fit visible model (F) · preserves view direction"
          onClick={onFit}
        >
          <Maximize size={15} />
        </button>
        <button
          aria-label={
            inspection ? 'Fit inspected face to view' : 'Fit selected CAD entities to view'
          }
          title={inspection ? 'Fit inspected face (Shift+F)' : 'Fit selection (Shift+F)'}
          disabled={!canFitSelection}
          onClick={onFitSelection}
        >
          <Focus size={15} />
        </button>
      </div>
      <div className="cad-view-group">
        <select
          aria-label="CAD display style"
          value={style}
          onChange={(event) => onStyle(event.target.value as CadDisplayStyle)}
        >
          <option value="edges">Shaded + edges</option>
          <option value="shaded">Shaded</option>
          <option value="wireframe">Wireframe</option>
        </select>
      </div>
    </div>
  );
}
