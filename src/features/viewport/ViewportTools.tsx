import {
  Maximize,
  RotateCcw,
  Focus,
  Eye,
  EyeOff,
  Ruler,
  ZoomIn,
  ZoomOut,
  MoreHorizontal,
  Flag,
} from 'lucide-react';
import type { CameraView } from './camera';
import Select from '../../shared/ui/Select';

type Props = {
  dimension: '2d' | '3d';
  view: CameraView | 'custom';
  selectionCount: number;
  isolated: boolean;
  measuring: boolean;
  conditionsShown: boolean;
  onView: (view: CameraView) => void;
  onFit: () => void;
  onFitSelection: () => void;
  onZoom: (factor: number) => void;
  onReset: () => void;
  onIsolate: () => void;
  onRestore: () => void;
  onMeasure: () => void;
  onConditions: () => void;
  onActions: (element: HTMLButtonElement) => void;
};

export default function ViewportTools(props: Props) {
  return (
    <div className="viewport-actions" role="toolbar" aria-label="Model view tools">
      <div className="viewport-action-group">
        <button title="Zoom in (+)" aria-label="Zoom in" onClick={() => props.onZoom(0.8)}>
          <ZoomIn size={15} />
        </button>
        <button title="Zoom out (−)" aria-label="Zoom out" onClick={() => props.onZoom(1.25)}>
          <ZoomOut size={15} />
        </button>
        <button title="Fit model (F)" aria-label="Fit model" onClick={props.onFit}>
          <Maximize size={15} />
          <span>Fit model</span>
        </button>
        <button
          title="Fit selected boundaries (Shift+F)"
          aria-label="Fit selection"
          disabled={!props.selectionCount}
          onClick={props.onFitSelection}
        >
          <Focus size={15} />
          <span>Fit selection</span>
        </button>
        <button title="Reset camera" aria-label="Reset camera" onClick={props.onReset}>
          <RotateCcw size={15} />
          <span>Reset</span>
        </button>
        <span className="viewport-tool-divider" />
        <label className="viewport-view-label">
          <span>View</span>
          <Select
            aria-label="Camera orientation"
            compact
            value={props.dimension === '2d' ? 'top' : props.view}
            disabled={props.dimension === '2d'}
            onChange={(value) => props.onView(value as CameraView)}
            options={
              props.dimension === '2d'
                ? [{ value: 'top', label: 'Plan · XY' }]
                : [
                    { value: 'custom', label: 'Custom orientation', disabled: true },
                    { value: 'isometric', label: 'Isometric' },
                    { value: 'front', label: 'Front · −Y' },
                    { value: 'back', label: 'Back · +Y' },
                    { value: 'right', label: 'Right · +X' },
                    { value: 'left', label: 'Left · −X' },
                    { value: 'top', label: 'Top · +Z' },
                    { value: 'bottom', label: 'Bottom · −Z' },
                  ]
            }
          />
        </label>
      </div>
      <div className="viewport-action-group viewport-selection-tools">
        <button
          title="Show selected boundaries only"
          aria-label="Isolate selected boundaries"
          aria-pressed={props.isolated}
          disabled={!props.selectionCount}
          onClick={props.onIsolate}
        >
          <EyeOff size={15} />
          <span>Isolate</span>
        </button>
        {props.isolated && (
          <button
            title="Restore all boundaries"
            aria-label="Restore all boundaries"
            onClick={props.onRestore}
          >
            <Eye size={15} />
            <span>Show all</span>
          </button>
        )}
        <button
          title="Measure undeformed distance between two mesh nodes or geometry vertices"
          aria-label="Measure undeformed node distance"
          aria-pressed={props.measuring}
          onClick={props.onMeasure}
        >
          <Ruler size={15} />
          <span>Measure</span>
        </button>
        <button
          title="Show or hide support and load symbols"
          aria-label="Show boundary condition symbols"
          aria-pressed={props.conditionsShown}
          onClick={props.onConditions}
        >
          <Flag size={15} />
          <span>Conditions</span>
        </button>
        <button
          title="Model actions (right-click or Shift+F10)"
          aria-label="Model actions"
          aria-haspopup="menu"
          onClick={(event) => props.onActions(event.currentTarget)}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}
