import { Maximize, RotateCcw, Focus, Eye, Ruler } from 'lucide-react';
import type { CameraView } from './camera';

type Props = {
  dimension: '2d' | '3d';
  view: CameraView | 'custom';
  selectionCount: number;
  isolated: boolean;
  measuring: boolean;
  onView: (view: CameraView) => void;
  onFit: () => void;
  onReset: () => void;
  onIsolate: () => void;
  onRestore: () => void;
  onMeasure: () => void;
};

export default function ViewportTools({
  dimension,
  view,
  selectionCount,
  isolated,
  measuring,
  onView,
  onFit,
  onReset,
  onIsolate,
  onRestore,
  onMeasure,
}: Props) {
  return (
    <div className="viewport-actions" role="toolbar" aria-label="Viewport tools">
      <label className="viewport-view-label">
        <span>View</span>
        <select
          aria-label="Camera orientation"
          value={dimension === '2d' ? 'top' : view}
          onChange={(event) => onView(event.target.value as CameraView)}
        >
          {dimension === '2d' ? (
            <option value="top">Normal · XY</option>
          ) : (
            <>
              <option value="custom" disabled>
                Custom orientation
              </option>
              <option value="isometric">Isometric</option>
              <option value="front">Front · −Y</option>
              <option value="back">Back · +Y</option>
              <option value="right">Right · +X</option>
              <option value="left">Left · −X</option>
              <option value="top">Top · +Z</option>
              <option value="bottom">Bottom · −Z</option>
            </>
          )}
        </select>
      </label>
      <button title="Fit model (F)" aria-label="Fit model" onClick={onFit}>
        <Maximize size={14} />
      </button>
      <button title="Reset camera" aria-label="Reset camera" onClick={onReset}>
        <RotateCcw size={14} />
      </button>
      <span className="viewport-tool-divider" />
      <button
        title="Show selected boundaries only"
        aria-label="Isolate selected boundaries"
        aria-pressed={isolated}
        disabled={selectionCount === 0}
        onClick={onIsolate}
      >
        <Focus size={14} />
        <span>Isolate</span>
      </button>
      <button
        title="Restore all boundaries"
        aria-label="Restore all boundaries"
        disabled={!isolated}
        onClick={onRestore}
      >
        <Eye size={14} />
        <span>Show all</span>
      </button>
      <span className="viewport-tool-divider" />
      <button
        title="Measure undeformed distance between two mesh nodes or geometry vertices"
        aria-label="Measure undeformed node distance"
        aria-pressed={measuring}
        onClick={onMeasure}
      >
        <Ruler size={14} />
        <span>Measure</span>
      </button>
    </div>
  );
}
