import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import {
  Circle,
  CornerUpRight,
  Maximize2,
  MousePointer2,
  Move,
  Plus,
  Minus,
  Square,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react';
import type {
  CadSketchConstraint,
  CadSketchDefinition,
  CadSketchEntity,
  CadSketchFeature,
  Point2,
} from '../../domain/contracts/project.generated';
import { formatValue, lengthFactor } from '../../domain/units';
import { NumberInput, NumericDraftContext } from '../../shared/forms/PropertyControls';
import {
  addSketchCircle,
  addSketchLine,
  addSketchRectangle,
  addSketchThreePointArc,
  deleteSketchSelection,
  entityPoints,
  entityPointIds,
  fitSketchView,
  formatSketchNumber,
  freshSketchId,
  lineDimensionPosition,
  moveSketchPoint,
  pointDistance,
  sketchGridSpacing,
  sketchReadiness,
  snapSketchPoint,
  threePointArc,
  type SketchSelection,
  type SketchView,
  type SnappedPoint,
} from './sketchInteractions';
import './CadSketchEditor.css';
import { pathIssue } from './advancedFeatures';
import {
  sketchConstraintLabel,
  sketchConstraintSelection,
  sketchPlaneAxes,
} from './sketchPresentation';

export interface CadSketchEditorProps {
  feature: CadSketchFeature;
  units: 'm' | 'mm';
  locked: boolean;
  onChange: (feature: CadSketchFeature) => void;
  onDraftChange?: (dirty: boolean) => void;
  onSolve?: () => Promise<void>;
  solving?: boolean;
  solveReport?: { status: string; degreesOfFreedom: number | null; failedConstraintIds: string[] };
}
type ConstraintInput<T = CadSketchConstraint> = T extends CadSketchConstraint
  ? Omit<T, 'id'>
  : never;
type Tool = 'select' | 'line' | 'polyline' | 'rectangle' | 'circle' | 'arc';
const tools = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'line', label: 'Line', key: 'L', icon: Minus },
  { id: 'polyline', label: 'Polyline', key: 'P', icon: Waypoints },
  { id: 'rectangle', label: 'Rectangle', key: 'R', icon: Square },
  { id: 'circle', label: 'Circle', key: 'C', icon: Circle },
  { id: 'arc', label: '3-point arc', key: 'A', icon: CornerUpRight },
] as const;
const instructions: Record<Tool, string> = {
  select:
    'Select a curve or point. Drag points to edit. Shift-click adds to selection; double-click a dimension to constrain it.',
  line: 'Click a start point, then the end point. Green guides add a horizontal or vertical constraint.',
  polyline:
    'Click connected endpoints. Click the first point to close; Escape ends an open chain. Each segment is saved.',
  rectangle:
    'Click two opposite corners. Four connected edges and horizontal/vertical constraints are created.',
  circle:
    'Click the center, then a point on the circle. Select it afterwards to set an exact diameter.',
  arc: 'Click the start, a point the arc passes through, then the end. Snap the ends to existing geometry.',
};
type Gesture =
  | {
      kind: 'point';
      pointId: string;
      source: CadSketchDefinition;
      original: Point2;
      moved: boolean;
    }
  | { kind: 'pan'; client: Point2; view: SketchView };

export default function CadSketchEditor(props: CadSketchEditorProps) {
  // A different feature starts a fresh drawing session; history updates retain the camera and tool.
  return <SketchEditorSession key={props.feature.id} {...props} />;
}
function SketchEditorSession({
  feature,
  units,
  locked,
  onChange,
  onDraftChange,
  onSolve,
  solving = false,
  solveReport,
}: CadSketchEditorProps) {
  const svg = useRef<SVGSVGElement>(null),
    container = useRef<HTMLDivElement>(null),
    context = useRef<HTMLElement>(null);
  const live = useRef({ feature, locked, onChange });
  live.current = { feature, locked, onChange };
  const [tool, setTool] = useState<Tool>('select');
  const [pending, setPending] = useState<SnappedPoint[]>([]);
  const [cursor, setCursor] = useState<SnappedPoint | null>(null);
  const [selection, setSelection] = useState<SketchSelection[]>([]);
  const [hovered, setHovered] = useState<SketchSelection | null>(null);
  const [dimensionEditId, setDimensionEditId] = useState<string | null>(null);
  const [view, setView] = useState<SketchView>(() => fitSketchView(feature.sketch));
  const [dragGraph, setDragGraph] = useState<CadSketchDefinition | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(true),
    [dimensions, setDimensions] = useState(true);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [numericDrafts, setNumericDrafts] = useState(new Map<string, string>());
  const numericDraftsRef = useRef(numericDrafts);
  const transientDraft = useRef(false);
  transientDraft.current = pending.length > 0 || !!dragGraph;
  const gesture = useRef<Gesture | null>(null),
    space = useRef(false);
  const draftCallback = useRef(onDraftChange);
  draftCallback.current = onDraftChange;
  const graph = dragGraph ?? feature.sketch,
    factor = lengthFactor(units);
  const spacing = sketchGridSpacing(view),
    pixel = view.width / size.width;
  const gridId = useId().replaceAll(':', '');
  const contours = sketchReadiness(graph);
  const readiness =
    feature.purpose === 'path' ? { ...contours, issue: pathIssue(graph) } : contours;
  const points = new Map(graph.points.map((point) => [point.id, point.position]));
  const chosenPoints = selection
    .filter((item) => item.kind === 'point')
    .map((item) => graph.points.find((point) => point.id === item.id))
    .filter((point) => point !== undefined);
  const chosenEntities = selection
    .filter((item) => item.kind === 'entity')
    .map((item) => graph.entities.find((entity) => entity.id === item.id))
    .filter((entity) => entity !== undefined);
  const chosenLine =
    chosenEntities.length === 1 && chosenEntities[0].kind === 'line' ? chosenEntities[0] : null;
  const chosenCurve =
    chosenEntities.length === 1 && chosenEntities[0].kind !== 'line' ? chosenEntities[0] : null;
  const distancePoints =
    chosenPoints.length === 2
      ? chosenPoints.map((point) => point.id)
      : chosenLine
        ? [chosenLine.startId, chosenLine.endId]
        : null;
  const selectedIds = new Set(selection.map((item) => item.id));
  const axes = sketchPlaneAxes(feature.plane);
  const failedIds = new Set(
    graph.constraints
      .filter((constraint) => solveReport?.failedConstraintIds.includes(constraint.id))
      .flatMap((constraint) => sketchConstraintSelection(graph, constraint).map((item) => item.id)),
  );
  const fixedPointIds = new Set(
    graph.constraints
      .filter((constraint) => constraint.kind === 'fixedPoint')
      .map((constraint) => constraint.pointId),
  );
  const relatedIds = new Set([...selectedIds, ...chosenEntities.flatMap(entityPointIds)]);
  const selectionConstraints = graph.constraints.filter((constraint) =>
    Object.entries(constraint).some(
      ([key, value]) => key.endsWith('Id') && relatedIds.has(String(value)),
    ),
  );
  const reportNumericValidity = useCallback((id: string, label: string | null) => {
    const before = numericDraftsRef.current;
    if ((before.get(id) ?? null) === label) return;
    const next = new Map(before);
    if (label) next.set(id, label);
    else next.delete(id);
    numericDraftsRef.current = next;
    setNumericDrafts(next);
    draftCallback.current?.(transientDraft.current || next.size > 0);
  }, []);
  useEffect(() => {
    draftCallback.current?.(pending.length > 0 || !!dragGraph || numericDrafts.size > 0);
    return () => draftCallback.current?.(false);
  }, [pending.length, dragGraph, numericDrafts.size]);
  useEffect(() => {
    if (!dimensionEditId) return;
    const row = Array.from(
      context.current?.querySelectorAll<HTMLElement>('[data-constraint-id]') ?? [],
    ).find((element) => element.dataset.constraintId === dimensionEditId);
    const input = row?.querySelector<HTMLInputElement>('input');
    if (!input || input.disabled) return;
    input.focus();
    input.select();
    input.scrollIntoView({ block: 'nearest' });
    setDimensionEditId(null);
  }, [dimensionEditId, feature.sketch]);
  useEffect(() => {
    svg.current?.focus();
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(entry.contentRect.width, 1),
        height = Math.max(entry.contentRect.height, 1);
      setSize({ width, height });
      setView((before) => ({ ...before, height: (before.width * height) / width }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const cancel = () => {
    setPending([]);
    setDragGraph(null);
    gesture.current = null;
    setCursor(null);
    setTool('select');
    setHovered(null);
    setMessage(null);
  };
  useEffect(() => {
    if (locked) cancel();
  }, [locked]);
  useEffect(() => {
    const ids = new Set(
      [...feature.sketch.points, ...feature.sketch.entities].map((item) => item.id),
    );
    setSelection((before) => before.filter((item) => ids.has(item.id)));
  }, [feature.sketch]);
  const commit = (next: CadSketchDefinition): boolean => {
    if (live.current.locked || numericDraftsRef.current.size) return false;
    try {
      live.current.onChange({ ...live.current.feature, sketch: next });
      setMessage(null);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const perform = (operation: () => CadSketchDefinition): CadSketchDefinition | null => {
    try {
      const next = operation();
      return commit(next) ? next : null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const chooseTool = (next: Tool) => {
    if (locked || numericDrafts.size) return;
    setTool(next);
    setHovered(null);
    setPending([]);
    setCursor(null);
    setDragGraph(null);
    gesture.current = null;
    setMessage(null);
  };
  const pointAt = (clientX: number, clientY: number): Point2 => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !svg.current) return view.center;
    const point = svg.current.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, -local.y];
  };
  const snapAt = (position: Point2, reference?: Point2, excludePointId?: string): SnappedPoint =>
    snapping
      ? snapSketchPoint(graph, position, pixel * 10, spacing, reference, excludePointId)
      : { position, kind: 'none' };
  const zoom = (multiplier: number, anchor = view.center) =>
    setView((before) => {
      const width = Math.min(4000, Math.max(1e-7, before.width * multiplier)),
        scale = width / before.width;
      return {
        width,
        height: before.height * scale,
        center: [
          anchor[0] + (before.center[0] - anchor[0]) * scale,
          anchor[1] + (before.center[1] - anchor[1]) * scale,
        ],
      };
    });
  const wheelHandler = useRef<((event: WheelEvent) => void) | null>(null);
  wheelHandler.current = (event) => {
    event.preventDefault();
    zoom(
      Math.exp(Math.max(-200, Math.min(200, event.deltaY)) * 0.002),
      pointAt(event.clientX, event.clientY),
    );
  };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const handler = (event: WheelEvent) => wheelHandler.current?.(event);
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, []);
  const select = (next: SketchSelection, additive: boolean) =>
    setSelection((before) =>
      additive
        ? before.some((item) => item.kind === next.kind && item.id === next.id)
          ? before.filter((item) => item.id !== next.id)
          : [...before, next]
        : [next],
    );
  const closePolyline = () => {
    if (pending.length < 3) {
      setMessage('Draw at least three endpoints before closing the chain.');
      return;
    }
    const next = perform(() => addSketchLine(feature.sketch, pending.at(-1)!, pending[0]));
    if (next) {
      setPending([]);
      setTool('select');
    }
  };
  const addClick = (point: SnappedPoint) => {
    if (!pending.length) {
      setPending([point]);
      return;
    }
    if (tool === 'polyline' || tool === 'line') {
      if (
        tool === 'polyline' &&
        pending.length >= 3 &&
        pointDistance(point.position, pending[0].position) <= pixel * 10
      ) {
        closePolyline();
        return;
      }
      const next = perform(() => addSketchLine(feature.sketch, pending.at(-1)!, point));
      if (!next) return;
      const line = next.entities.at(-1)!;
      if (line.kind !== 'line') return;
      if (tool === 'line') setPending([]);
      else {
        const first = pending.length === 1 ? { ...pending[0], pointId: line.startId } : pending[0];
        setPending([first, ...pending.slice(1), { ...point, pointId: line.endId }]);
      }
      return;
    }
    if (tool === 'arc' && pending.length === 1) {
      setPending([...pending, point]);
      return;
    }
    const next = perform(() =>
      tool === 'rectangle'
        ? addSketchRectangle(feature.sketch, pending[0], point)
        : tool === 'circle'
          ? addSketchCircle(feature.sketch, pending[0], point.position)
          : addSketchThreePointArc(feature.sketch, pending[0], pending[1].position, point),
    );
    if (next) {
      setPending([]);
      setSelection([{ kind: 'entity', id: next.entities.at(-1)!.id }]);
    }
  };
  const beginCanvas = (event: PointerEvent<SVGSVGElement>) => {
    svg.current?.focus();
    if (event.button === 1 || (space.current && event.button === 0)) {
      event.preventDefault();
      gesture.current = { kind: 'pan', client: [event.clientX, event.clientY], view };
      svg.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (locked || numericDrafts.size || event.button !== 0) return;
    if (tool === 'select') {
      if (!event.shiftKey) setSelection([]);
      return;
    }
    const snapped = snapAt(pointAt(event.clientX, event.clientY), pending.at(-1)?.position);
    setCursor(snapped);
    addClick(snapped);
  };
  const beginPoint = (event: PointerEvent<SVGCircleElement>, id: string) => {
    if (tool !== 'select' || space.current || event.button !== 0) return;
    event.stopPropagation();
    svg.current?.focus();
    select({ kind: 'point', id }, event.shiftKey);
    if (locked || numericDrafts.size || event.shiftKey) return;
    if (
      feature.sketch.constraints.some(
        (constraint) => constraint.kind === 'fixedPoint' && constraint.pointId === id,
      )
    ) {
      setMessage('This point is fixed. Remove the fixed constraint before moving its anchor.');
      return;
    }
    setHovered(null);
    gesture.current = {
      kind: 'point',
      pointId: id,
      source: structuredClone(feature.sketch),
      original: [...points.get(id)!],
      moved: false,
    };
    svg.current?.setPointerCapture(event.pointerId);
  };
  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current;
    if (active?.kind === 'pan') {
      setView({
        ...active.view,
        center: [
          active.view.center[0] -
            ((event.clientX - active.client[0]) * active.view.width) / size.width,
          active.view.center[1] +
            ((event.clientY - active.client[1]) * active.view.height) / size.height,
        ],
      });
      return;
    }
    if (locked) return;
    const snapped = snapAt(
      pointAt(event.clientX, event.clientY),
      active?.kind === 'point' ? undefined : pending.at(-1)?.position,
      active?.kind === 'point' ? active.pointId : undefined,
    );
    setCursor(snapped);
    if (active?.kind === 'point') {
      if (pointDistance(active.original, snapped.position) < pixel * 2 && !active.moved) return;
      active.moved = true;
      try {
        setDragGraph(moveSketchPoint(active.source, active.pointId, snapped.position));
        setMessage(null);
      } catch (error) {
        setMessage(String(error));
      }
    }
  };
  const endPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.kind === 'point' && dragGraph && !locked) commit(dragGraph);
    gesture.current = null;
    setDragGraph(null);
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
  };
  const deleteSelection = () => {
    if (!selection.length || locked) return;
    if (perform(() => deleteSketchSelection(feature.sketch, selection))) setSelection([]);
  };
  const addConstraint = (constraint: ConstraintInput): string | null => {
    if (
      'value' in constraint &&
      (!(constraint.value > 0) || !Number.isFinite(constraint.value) || constraint.value > 1000)
    ) {
      setMessage('Enter a positive distance or diameter at most 1000 m.');
      return null;
    }
    const next = structuredClone(feature.sketch);
    if (next.constraints.length >= 512) {
      setMessage('This sketch has reached the constraint limit.');
      return null;
    }
    const key = JSON.stringify(constraint);
    if (next.constraints.some(({ id: _id, ...existing }) => JSON.stringify(existing) === key)) {
      setMessage('This constraint already exists.');
      return null;
    }
    const id = freshSketchId('constraint');
    next.constraints.push({ ...constraint, id } as CadSketchConstraint);
    return commit(next) ? id : null;
  };
  const updateConstraint = (id: string, value: number) => {
    const next = structuredClone(feature.sketch),
      constraint = next.constraints.find((item) => item.id === id);
    if (constraint && 'value' in constraint) constraint.value = value;
    commit(next);
  };
  const editDimension = (entity: CadSketchEntity) => {
    if (locked || numericDrafts.size || pending.length) return;
    select({ kind: 'entity', id: entity.id }, false);
    const existing = feature.sketch.constraints.find((constraint) =>
      entity.kind === 'line'
        ? constraint.kind === 'distance' &&
          ((constraint.firstPointId === entity.startId &&
            constraint.secondPointId === entity.endId) ||
            (constraint.firstPointId === entity.endId &&
              constraint.secondPointId === entity.startId))
        : constraint.kind === 'diameter' && constraint.curveId === entity.id,
    );
    const id =
      existing?.id ??
      addConstraint(
        entity.kind === 'line'
          ? {
              kind: 'distance',
              firstPointId: entity.startId,
              secondPointId: entity.endId,
              value: pointDistance(points.get(entity.startId)!, points.get(entity.endId)!),
            }
          : {
              kind: 'diameter',
              curveId: entity.id,
              value:
                2 *
                (entity.kind === 'circle'
                  ? entity.radius
                  : pointDistance(points.get(entity.centerId)!, points.get(entity.startId)!)),
            },
      );
    if (id) setDimensionEditId(id);
  };
  const curveRadius = chosenCurve
    ? chosenCurve.kind === 'circle'
      ? chosenCurve.radius
      : pointDistance(points.get(chosenCurve.centerId)!, points.get(chosenCurve.startId)!)
    : null;
  let preview: Point2[] = [];
  if (pending.length && cursor) {
    const a = pending[0].position,
      b = cursor.position;
    if (tool === 'rectangle') preview = [a, [b[0], a[1]], b, [a[0], b[1]], a];
    else if (tool === 'circle')
      preview = Array.from({ length: 65 }, (_, i) => [
        a[0] + pointDistance(a, b) * Math.cos((i / 64) * Math.PI * 2),
        a[1] + pointDistance(a, b) * Math.sin((i / 64) * Math.PI * 2),
      ]);
    else if (tool === 'arc' && pending.length === 2) {
      try {
        const arc = threePointArc(a, pending[1].position, b);
        const radius = pointDistance(a, arc.center),
          start = Math.atan2(a[1] - arc.center[1], a[0] - arc.center[0]);
        let angle = Math.atan2(b[1] - arc.center[1], b[0] - arc.center[0]) - start;
        if (arc.clockwise && angle >= 0) angle -= 2 * Math.PI;
        if (!arc.clockwise && angle <= 0) angle += 2 * Math.PI;
        preview = Array.from({ length: 49 }, (_, i) => [
          arc.center[0] + radius * Math.cos(start + (angle * i) / 48),
          arc.center[1] + radius * Math.sin(start + (angle * i) / 48),
        ]);
      } catch {
        preview = [a, pending[1].position, b];
      }
    } else preview = [pending.at(-1)!.position, b];
  }
  const path = (vertices: Point2[]) =>
    vertices.map((point, i) => `${i ? 'L' : 'M'} ${point[0]} ${-point[1]}`).join(' ');
  const numberField = (
    label: string,
    value: number,
    change: (value: number) => void,
    positive = false,
    disabled = false,
  ) => (
    <NumberInput
      label={label}
      value={value * factor}
      unit={units}
      disabled={locked || pending.length > 0 || disabled}
      positive={positive}
      commitMode="finish"
      format={(value) => formatSketchNumber(value, fitSketchView(feature.sketch).width * factor)}
      minimum={positive ? 0 : -1000 * factor}
      maximum={1000 * factor}
      onChange={(value) => change(value / factor)}
    />
  );
  return (
    <NumericDraftContext.Provider value={reportNumericValidity}>
      <div
        className="cad-sketch-editor"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('input,textarea,select')) {
            if (
              event.key === 'Enter' &&
              (event.target as HTMLElement).tagName === 'INPUT' &&
              !numericDraftsRef.current.size &&
              !pending.length &&
              !dragGraph &&
              !locked &&
              !solving
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (onSolve) void onSolve().catch((error) => setMessage(String(error)));
              else
                setMessage(
                  'Driving dimensions are saved. Use the desktop app to solve constraints and update the displayed geometry.',
                );
            }
            return;
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if ((event.target as HTMLElement).closest('button') && event.key !== 'Escape') return;
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          } else if (event.key === ' ') {
            event.preventDefault();
            space.current = true;
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            deleteSelection();
          } else if (event.key === 'Enter' && tool === 'polyline') {
            event.preventDefault();
            closePolyline();
          } else if (event.key.toLowerCase() === 'f')
            setView(fitSketchView(graph, size.width / size.height));
          else {
            const next = tools.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
            if (next) chooseTool(next.id);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ') space.current = false;
        }}
        onBlur={() => {
          space.current = false;
        }}
      >
        <div className="cad-sketch-tools" role="toolbar" aria-label="Sketch drawing tools">
          {tools.map(({ id, label, key, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={tool === id ? 'active' : ''}
              aria-pressed={tool === id}
              title={`${label} (${key})`}
              disabled={locked || numericDrafts.size > 0}
              onClick={() => chooseTool(id)}
            >
              <Icon size={16} />
              {label}
              <kbd>{key}</kbd>
            </button>
          ))}
          <div className="cad-sketch-view-tools">
            {
              <button
                type="button"
                title={
                  onSolve
                    ? 'Solve the current sketch constraints locally'
                    : 'Constraint solving requires the desktop CAD kernel'
                }
                disabled={
                  !onSolve ||
                  locked ||
                  solving ||
                  pending.length > 0 ||
                  !!dragGraph ||
                  numericDrafts.size > 0
                }
                onClick={() => void onSolve?.().catch((error) => setMessage(String(error)))}
              >
                {solving ? 'Solving…' : 'Solve constraints'}
              </button>
            }
            <button
              type="button"
              aria-label="Fit sketch"
              title="Fit sketch (F)"
              onClick={() => setView(fitSketchView(graph, size.width / size.height))}
            >
              <Maximize2 size={16} />
            </button>
            <button type="button" aria-label="Zoom in sketch" onClick={() => zoom(0.8)}>
              <Plus size={16} />
            </button>
            <button type="button" aria-label="Zoom out sketch" onClick={() => zoom(1.25)}>
              <Minus size={16} />
            </button>
          </div>
        </div>
        <div className="cad-sketch-instruction" aria-live="polite">
          <strong>{tools.find((item) => item.id === tool)?.label}</strong>
          <span>{instructions[tool]}</span>
          {pending.length > 0 && (
            <button type="button" onClick={cancel}>
              <X size={13} />
              Cancel drawing
            </button>
          )}
          {tool === 'polyline' && pending.length >= 3 && (
            <button type="button" onClick={closePolyline}>
              Close chain
            </button>
          )}
        </div>
        <div className="cad-sketch-body">
          <div
            ref={container}
            className={`cad-sketch-drawing ${tool !== 'select' ? 'drawing' : ''}`}
          >
            <svg
              ref={svg}
              viewBox={`${view.center[0] - view.width / 2} ${-view.center[1] - view.height / 2} ${view.width} ${view.height}`}
              role="application"
              aria-label={`Sketch drawing area on ${feature.plane.toUpperCase()} plane`}
              tabIndex={0}
              onPointerDown={beginCanvas}
              onPointerMove={movePointer}
              onPointerUp={endPointer}
              onPointerCancel={() => {
                gesture.current = null;
                setDragGraph(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                cancel();
              }}
            >
              <defs>
                <pattern id={gridId} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
                  <path
                    d={`M ${spacing} 0 L 0 0 0 ${spacing}`}
                    className="cad-sketch-grid"
                    vectorEffect="non-scaling-stroke"
                  />
                </pattern>
              </defs>
              <rect
                x={view.center[0] - view.width / 2}
                y={-view.center[1] - view.height / 2}
                width={view.width}
                height={view.height}
                fill={`url(#${gridId})`}
              />
              <path
                d={`M ${view.center[0] - view.width / 2} 0 H ${view.center[0] + view.width / 2}`}
                className="cad-sketch-axis x"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={`M 0 ${-view.center[1] - view.height / 2} V ${-view.center[1] + view.height / 2}`}
                className="cad-sketch-axis y"
                vectorEffect="non-scaling-stroke"
              />
              <g className="cad-sketch-axis-labels" pointerEvents="none">
                <text
                  x={view.center[0] + view.width / 2 - pixel * 14}
                  y={Math.max(
                    -view.center[1] - view.height / 2 + pixel * 18,
                    Math.min(-pixel * 8, -view.center[1] + view.height / 2 - pixel * 12),
                  )}
                  fontSize={pixel * 11}
                  textAnchor="end"
                >
                  {axes[0]} · u
                </text>
                <text
                  x={Math.max(
                    view.center[0] - view.width / 2 + pixel * 10,
                    Math.min(pixel * 8, view.center[0] + view.width / 2 - pixel * 42),
                  )}
                  y={-view.center[1] - view.height / 2 + pixel * 18}
                  fontSize={pixel * 11}
                >
                  {axes[1]} · v
                </text>
              </g>
              <circle cx={0} cy={0} r={pixel * 4} className="cad-sketch-origin" />
              {graph.entities.map((entity) => {
                const vertices = entityPoints(graph, entity),
                  selected = selectedIds.has(entity.id);
                const middle = vertices[Math.floor(vertices.length / 2)],
                  length =
                    entity.kind === 'line'
                      ? pointDistance(vertices[0], vertices[1])
                      : entity.kind === 'circle'
                        ? 2 * entity.radius
                        : null;
                const driving =
                  entity.kind === 'line'
                    ? graph.constraints.find(
                        (constraint) =>
                          constraint.kind === 'distance' &&
                          ((constraint.firstPointId === entity.startId &&
                            constraint.secondPointId === entity.endId) ||
                            (constraint.firstPointId === entity.endId &&
                              constraint.secondPointId === entity.startId)),
                      )
                    : graph.constraints.find(
                        (constraint) =>
                          constraint.kind === 'diameter' && constraint.curveId === entity.id,
                      );
                const target = driving && 'value' in driving ? driving.value : null;
                const differentTarget =
                  length !== null &&
                  target !== null &&
                  Math.abs(length - target) >
                    1e-8 * Math.max(Math.abs(length), Math.abs(target), 1e-9);
                const lineLabel =
                  entity.kind === 'line' ? lineDimensionPosition(graph, entity, pixel * 18) : null;
                return (
                  <g
                    key={entity.id}
                    className={`${selected ? 'selected' : ''} ${hovered?.kind === 'entity' && hovered.id === entity.id ? 'prehighlighted' : ''} ${failedIds.has(entity.id) || entityPointIds(entity).some((id) => failedIds.has(id)) ? 'constraint-hint' : ''}`}
                  >
                    <path
                      d={path(vertices)}
                      className="cad-sketch-curve"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={path(vertices)}
                      className="cad-sketch-hit"
                      role="button"
                      aria-label={`Select ${entity.name}`}
                      onPointerEnter={() => {
                        if (tool === 'select' && !gesture.current)
                          setHovered({ kind: 'entity', id: entity.id });
                      }}
                      onPointerLeave={() =>
                        setHovered((before) =>
                          before?.kind === 'entity' && before.id === entity.id ? null : before,
                        )
                      }
                      aria-pressed={selected}
                      tabIndex={tool === 'select' ? 0 : -1}
                      vectorEffect="non-scaling-stroke"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          select({ kind: 'entity', id: entity.id }, event.shiftKey);
                        }
                      }}
                      onPointerDown={(event) => {
                        if (tool === 'select' && !space.current && event.button === 0) {
                          event.stopPropagation();
                          svg.current?.focus();
                          select({ kind: 'entity', id: entity.id }, event.shiftKey);
                        }
                      }}
                    />
                    {dimensions && length !== null && (
                      <text
                        className={`cad-sketch-dimension ${tool === 'select' ? 'interactive' : ''}`}
                        role={tool === 'select' ? 'button' : undefined}
                        aria-label={
                          tool === 'select' ? `Edit dimension of ${entity.name}` : undefined
                        }
                        tabIndex={tool === 'select' ? 0 : -1}
                        onPointerDown={(event) => {
                          if (tool === 'select') {
                            event.stopPropagation();
                            select({ kind: 'entity', id: entity.id }, event.shiftKey);
                          }
                        }}
                        onDoubleClick={(event) => {
                          if (tool === 'select') {
                            event.stopPropagation();
                            editDimension(entity);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            editDimension(entity);
                          }
                        }}
                        x={
                          entity.kind === 'circle' ? points.get(entity.centerId)![0] : lineLabel![0]
                        }
                        y={
                          entity.kind === 'circle'
                            ? -points.get(entity.centerId)![1] - entity.radius - pixel * 8
                            : -lineLabel![1]
                        }
                        fontSize={pixel * 11}
                      >
                        {entity.kind === 'circle' ? '⌀ ' : ''}
                        {formatValue(length * factor)} {units}
                        {differentTarget && ` · target ${formatValue(target! * factor)} ${units}`}
                      </text>
                    )}
                    {entity.kind === 'arc' && selected && (
                      <text
                        className="cad-sketch-dimension"
                        x={middle[0]}
                        y={-middle[1] - pixel * 8}
                        fontSize={pixel * 11}
                      >
                        R{' '}
                        {formatValue(
                          pointDistance(points.get(entity.centerId)!, vertices[0]) * factor,
                        )}{' '}
                        {units}
                      </text>
                    )}
                  </g>
                );
              })}
              {graph.points.map((point) => (
                <g
                  key={point.id}
                  className={`${selectedIds.has(point.id) ? 'selected' : ''} ${hovered?.kind === 'point' && hovered.id === point.id ? 'prehighlighted' : ''} ${failedIds.has(point.id) ? 'constraint-hint' : ''}`}
                >
                  <circle
                    className="cad-sketch-point-hit"
                    role="button"
                    aria-label={`Select point at ${formatValue(point.position[0] * factor)}, ${formatValue(point.position[1] * factor)} ${units}`}
                    aria-pressed={selectedIds.has(point.id)}
                    tabIndex={tool === 'select' ? 0 : -1}
                    cx={point.position[0]}
                    cy={-point.position[1]}
                    r={pixel * 9}
                    onPointerEnter={() => {
                      if (tool === 'select' && !gesture.current)
                        setHovered({ kind: 'point', id: point.id });
                    }}
                    onPointerLeave={() =>
                      setHovered((before) =>
                        before?.kind === 'point' && before.id === point.id ? null : before,
                      )
                    }
                    onPointerDown={(event) => beginPoint(event, point.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        select({ kind: 'point', id: point.id }, event.shiftKey);
                      }
                    }}
                  />
                  <circle
                    className="cad-sketch-point"
                    cx={point.position[0]}
                    cy={-point.position[1]}
                    r={pixel * (selectedIds.has(point.id) ? 4.5 : 3)}
                    pointerEvents="none"
                  />
                </g>
              ))}
              {preview.length > 0 && (
                <path
                  d={path(preview)}
                  className="cad-sketch-preview"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pending.map((point, i) => (
                <circle
                  key={i}
                  cx={point.position[0]}
                  cy={-point.position[1]}
                  r={pixel * 4}
                  className="cad-sketch-pending-point"
                  pointerEvents="none"
                />
              ))}
              {cursor && tool !== 'select' && (
                <g pointerEvents="none">
                  <circle
                    cx={cursor.position[0]}
                    cy={-cursor.position[1]}
                    r={pixel * 6}
                    className={`cad-sketch-snap ${cursor.kind}`}
                    vectorEffect="non-scaling-stroke"
                  />
                  {(cursor.kind === 'horizontal' || cursor.kind === 'vertical') &&
                    pending.length > 0 && (
                      <path
                        d={path([pending.at(-1)!.position, cursor.position])}
                        className="cad-sketch-inference"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  <text
                    x={cursor.position[0] + pixel * 12}
                    y={-cursor.position[1] - pixel * 12}
                    fontSize={pixel * 11}
                    className="cad-sketch-cursor-label"
                  >
                    {cursor.kind !== 'grid' && cursor.kind !== 'none' ? `${cursor.kind} · ` : ''}
                    {formatValue(cursor.position[0] * factor)},{' '}
                    {formatValue(cursor.position[1] * factor)} {units}
                  </text>
                </g>
              )}
            </svg>
            {!graph.entities.length && !pending.length && (
              <div className="cad-sketch-empty">
                <Square size={28} />
                <strong>Your sketch starts here</strong>
                <span>
                  Choose a drawing tool, then click in the canvas.
                  <br />
                  The red and green axes meet at the origin.
                </span>
              </div>
            )}
            {locked && (
              <div className="cad-sketch-lock">
                Sketch editing is paused during the active operation.
              </div>
            )}
          </div>
          <aside
            ref={context}
            className="cad-sketch-context"
            aria-label="Sketch selection properties"
          >
            <h3>{selection.length ? `${selection.length} selected` : 'Sketch'}</h3>
            {graph.constraints.length > 0 && !solveReport && (
              <p className="cad-sketch-readiness">
                <strong>Needs solve.</strong> Displayed curves show authored coordinates.{' '}
                {onSolve
                  ? 'Solve constraints or press Enter after entering a dimension to update them.'
                  : 'Open this project in the desktop app to solve the saved constraints.'}
              </p>
            )}
            {!selection.length && (
              <p>
                Select a curve or point for dimensions and constraints. Use Shift-click to select
                two points or curves.
              </p>
            )}
            {chosenPoints.length === 1 && (
              <>
                <h4>Point position · {feature.plane.toUpperCase()} plane</h4>
                {fixedPointIds.has(chosenPoints[0].id) && (
                  <p>
                    This point is fixed. Remove its Fixed point constraint below to edit or drag it.
                  </p>
                )}
                {numberField(
                  `Point ${axes[0]}`,
                  chosenPoints[0].position[0],
                  (value) =>
                    perform(() =>
                      moveSketchPoint(feature.sketch, chosenPoints[0].id, [
                        value,
                        chosenPoints[0].position[1],
                      ]),
                    ),
                  false,
                  fixedPointIds.has(chosenPoints[0].id),
                )}
                {numberField(
                  `Point ${axes[1]}`,
                  chosenPoints[0].position[1],
                  (value) =>
                    perform(() =>
                      moveSketchPoint(feature.sketch, chosenPoints[0].id, [
                        chosenPoints[0].position[0],
                        value,
                      ]),
                    ),
                  false,
                  fixedPointIds.has(chosenPoints[0].id),
                )}
                <button
                  type="button"
                  disabled={locked || numericDrafts.size > 0}
                  onClick={() => addConstraint({ kind: 'fixedPoint', pointId: chosenPoints[0].id })}
                >
                  Fix selected point
                </button>
              </>
            )}
            {chosenLine && (
              <>
                <h4>{chosenLine.name}</h4>
                <div className="cad-sketch-constraint-actions">
                  <button
                    type="button"
                    disabled={locked || numericDrafts.size > 0}
                    onClick={() => addConstraint({ kind: 'horizontal', lineId: chosenLine.id })}
                  >
                    Horizontal
                  </button>
                  <button
                    type="button"
                    disabled={locked || numericDrafts.size > 0}
                    onClick={() => addConstraint({ kind: 'vertical', lineId: chosenLine.id })}
                  >
                    Vertical
                  </button>
                </div>
              </>
            )}
            {distancePoints && (
              <button
                type="button"
                disabled={locked || numericDrafts.size > 0}
                onClick={() =>
                  addConstraint({
                    kind: 'distance',
                    firstPointId: distancePoints[0],
                    secondPointId: distancePoints[1],
                    value: pointDistance(
                      points.get(distancePoints[0])!,
                      points.get(distancePoints[1])!,
                    ),
                  })
                }
              >
                Set distance ·{' '}
                {formatValue(
                  pointDistance(points.get(distancePoints[0])!, points.get(distancePoints[1])!) *
                    factor,
                )}{' '}
                {units}
              </button>
            )}
            {chosenPoints.length === 2 && (
              <button
                type="button"
                disabled={locked || numericDrafts.size > 0}
                onClick={() =>
                  addConstraint({
                    kind: 'coincident',
                    firstPointId: chosenPoints[0].id,
                    secondPointId: chosenPoints[1].id,
                  })
                }
              >
                Make points coincident
              </button>
            )}
            {chosenCurve && curveRadius !== null && (
              <>
                <h4>{chosenCurve.name}</h4>
                {chosenCurve.kind === 'circle' &&
                  numberField(
                    'Circle radius',
                    chosenCurve.radius,
                    (value) => {
                      const next = structuredClone(feature.sketch),
                        curve = next.entities.find((item) => item.id === chosenCurve.id);
                      if (curve?.kind === 'circle') curve.radius = value;
                      commit(next);
                    },
                    true,
                  )}
                <button
                  type="button"
                  disabled={locked || numericDrafts.size > 0}
                  onClick={() =>
                    addConstraint({
                      kind: 'diameter',
                      curveId: chosenCurve.id,
                      value: curveRadius * 2,
                    })
                  }
                >
                  Constrain diameter · {formatValue(curveRadius * 2 * factor)} {units}
                </button>
              </>
            )}
            {chosenEntities.length === 2 &&
              chosenEntities.every((entity) => entity.kind === 'line') && (
                <div className="cad-sketch-constraint-actions">
                  {(['equalLength', 'parallel', 'perpendicular'] as const).map((kind) => (
                    <button
                      type="button"
                      key={kind}
                      disabled={locked || numericDrafts.size > 0}
                      onClick={() =>
                        addConstraint({
                          kind,
                          firstLineId: chosenEntities[0].id,
                          secondLineId: chosenEntities[1].id,
                        })
                      }
                    >
                      {kind === 'equalLength'
                        ? 'Equal length'
                        : kind === 'parallel'
                          ? 'Parallel'
                          : 'Perpendicular'}
                    </button>
                  ))}
                </div>
              )}
            {chosenEntities.length === 2 &&
              chosenEntities.every((entity) => entity.kind !== 'line') && (
                <button
                  type="button"
                  disabled={locked || numericDrafts.size > 0}
                  onClick={() =>
                    addConstraint({
                      kind: 'equalRadius',
                      firstCurveId: chosenEntities[0].id,
                      secondCurveId: chosenEntities[1].id,
                    })
                  }
                >
                  Equal radius
                </button>
              )}
            {selection.length > 0 && (
              <button
                className="cad-sketch-delete"
                type="button"
                disabled={locked || numericDrafts.size > 0}
                onClick={deleteSelection}
              >
                <Trash2 size={13} />
                Delete selected
              </button>
            )}
            <h4>
              {selection.length ? 'Related constraints' : 'Constraints'}{' '}
              <small>
                {selection.length ? selectionConstraints.length : graph.constraints.length}
              </small>
            </h4>
            {(selection.length ? selectionConstraints : graph.constraints).map((constraint) => (
              <div
                key={constraint.id}
                data-constraint-id={constraint.id}
                className={`cad-sketch-constraint ${solveReport?.failedConstraintIds.includes(constraint.id) ? 'failed' : ''}`}
              >
                <button
                  className="cad-sketch-constraint-reference"
                  type="button"
                  title="Select referenced geometry"
                  aria-label={`Select geometry for ${sketchConstraintLabel(constraint.kind)} constraint`}
                  disabled={locked || numericDrafts.size > 0}
                  onClick={() => setSelection(sketchConstraintSelection(graph, constraint))}
                >
                  {sketchConstraintLabel(constraint.kind)}
                </button>
                <button
                  type="button"
                  title="Remove constraint"
                  aria-label={`Remove ${sketchConstraintLabel(constraint.kind)} constraint`}
                  disabled={locked || numericDrafts.size > 0}
                  onClick={() => {
                    const next = structuredClone(feature.sketch);
                    next.constraints = next.constraints.filter((item) => item.id !== constraint.id);
                    commit(next);
                  }}
                >
                  <X size={12} />
                </button>
                {'value' in constraint &&
                  numberField(
                    `${constraint.kind === 'diameter' ? 'Diameter' : 'Distance'} constraint`,
                    constraint.value,
                    (value) => updateConstraint(constraint.id, value),
                    true,
                  )}
              </div>
            ))}
            <h4>{feature.purpose === 'path' ? 'Sweep path' : 'Contours'}</h4>
            <p>
              {readiness.closedLoops} closed · {readiness.openEntities} open curve
              {readiness.openEntities === 1 ? '' : 's'}
            </p>
            {graph.loops.map((loop, i) => (
              <label className="cad-sketch-loop" key={loop.id}>
                <span>
                  Loop {i + 1} · {loop.entityIds.length} curve
                  {loop.entityIds.length === 1 ? '' : 's'}
                </span>
                <select
                  aria-label={`Role of sketch loop ${i + 1}`}
                  value={loop.role}
                  disabled={locked || numericDrafts.size > 0 || pending.length > 0}
                  onChange={(event) => {
                    const next = structuredClone(feature.sketch);
                    next.loops.find((item) => item.id === loop.id)!.role = event.target.value as
                      'outer' | 'hole';
                    commit(next);
                  }}
                >
                  <option value="outer">Outer outline</option>
                  <option value="hole">Hole</option>
                </select>
              </label>
            ))}
            {readiness.issue && (
              <p className="cad-sketch-readiness">
                {readiness.issue} You can keep editing or save the open sketch.
              </p>
            )}
            {!readiness.issue && (
              <p className="cad-sketch-readiness">
                {feature.purpose === 'path'
                  ? 'Path connected · Finish sketch, then choose Sweep and a closed profile.'
                  : 'Contours closed · Rebuild checks intersections and hole placement.'}
              </p>
            )}
            {solveReport && (
              <div className="cad-sketch-solve-report">
                <strong>Last constraint solve</strong>
                <span>
                  {solveReport.status} ·{' '}
                  {solveReport.degreesOfFreedom === null
                    ? 'DOF unavailable'
                    : `${solveReport.degreesOfFreedom} degrees of freedom`}
                </span>
                <small>Use Solve constraints to check the current sketch.</small>
              </div>
            )}
          </aside>
        </div>
        {message && (
          <div className="cad-sketch-message" role="alert">
            {message}
            <button
              type="button"
              aria-label="Dismiss sketch message"
              onClick={() => setMessage(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <footer className="cad-sketch-status">
          <label>
            <input
              type="checkbox"
              checked={snapping}
              onChange={(event) => setSnapping(event.target.checked)}
            />
            Snap
          </label>
          <label>
            <input
              type="checkbox"
              checked={dimensions}
              onChange={(event) => setDimensions(event.target.checked)}
            />
            Dimensions
          </label>
          <span>
            Grid {formatValue(spacing * factor)} {units}
          </span>
          <span>
            {feature.plane.toUpperCase()} plane · u = {axes[0]}, v = {axes[1]}
          </span>
          {graph.constraints.length > 0 && !solveReport && (
            <span className="cad-sketch-needs-solve">Needs solve</span>
          )}
          <span className="cad-sketch-shortcuts">
            <Move size={12} />
            Space-drag / middle button to pan · Wheel to zoom · Esc to select
          </span>
        </footer>
      </div>
    </NumericDraftContext.Provider>
  );
}
