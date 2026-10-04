import { useCallback, useId, useRef, useState, type PointerEvent } from 'react';
import {
  Maximize2,
  MousePointer2,
  Square,
  Pentagon,
  Circle,
  RectangleEllipsis,
  Focus,
  Check,
  RotateCcw,
  X,
  Scissors,
} from 'lucide-react';
import type { Point2, Profile } from '../../domain/contracts/project.generated';
import { profileError, sampleSegment, setArcRadius } from '../../domain/project/profile';
import {
  addSketchHole,
  moveSketchVertex,
  rectangleSketchLoop,
  replaceSketchLoop,
  sketchBounds,
  sketchGridSpacing,
  snapPoint,
  slotSketchLoop,
  splitSketchEdge,
} from '../../domain/project/sketch';
import { formatValue } from '../../domain/units';
import { NumberInput, NumericDraftContext } from '../../shared/forms/PropertyControls';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import Select from '../../shared/ui/Select';
import './SketchCanvas.css';

type Tool = 'select' | 'rectangle' | 'polyline' | 'hole' | 'slot';
type Selection = { kind: 'vertex' | 'edge' | 'hole'; index: number } | null;
type Props = {
  profile: Profile;
  factor: number;
  unit: 'mm' | 'm';
  reservedIds: string[];
  onApply: (profile: Profile) => boolean;
  onSelectBoundary: (id: string) => void;
};
const tools: { id: Tool; label: string; icon: typeof Square; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    hint: 'Select an edge or hole. Drag a vertex or hole center; edit its coordinates below.',
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    icon: Square,
    hint: 'Click two opposite corners to replace the outer loop. New edges get new IDs; review assignments after applying.',
  },
  {
    id: 'polyline',
    label: 'Polyline',
    icon: Pentagon,
    hint: 'Click 3–64 vertices, then Close loop or Enter. The outer loop is ordered counterclockwise.',
  },
  {
    id: 'slot',
    label: 'Slot',
    icon: RectangleEllipsis,
    hint: 'Click the two end centers, then the side to set the radius. Creates an exact outline with tangent lines and semicircles; review assignments after Apply.',
  },
  {
    id: 'hole',
    label: 'Hole',
    icon: Circle,
    hint: 'Click the center, then a point on the circle. Holes must stay strictly inside the outer loop.',
  },
];

export default function SketchCanvas(props: Props) {
  // A profile update from history or a numeric editor starts a new draft.
  return <SketchDraft key={JSON.stringify(props.profile)} {...props} />;
}
function SketchDraft({ profile, factor, unit, reservedIds, onApply, onSelectBoundary }: Props) {
  const [draft, setDraft] = useState<Profile>(() => structuredClone(profile));
  const [view, setView] = useState(() => sketchBounds(profile));
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [pending, setPending] = useState<Point2[]>([]);
  const [cursor, setCursor] = useState<Point2 | null>(null);
  const [snap, setSnap] = useState(true);
  const [spacing, setSpacing] = useState(() => sketchGridSpacing(sketchBounds(profile)));
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<string | null>(null);
  const [invalidNumbers, setInvalidNumbers] = useState(new Map<string, string>());
  const reportNumericValidity = useCallback(
    (id: string, label: string | null) =>
      setInvalidNumbers((before) => {
        if ((before.get(id) ?? null) === label) return before;
        const next = new Map(before);
        if (label) next.set(id, label);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Selection>(null);
  const retiredIds = useRef(
    new Set([
      ...reservedIds,
      ...profile.outer.map((item) => item.id),
      ...profile.holes.map((item) => item.id),
    ]),
  );
  const drawing = useRef(false);
  const gridId = useId().replaceAll(':', '');
  const error = profileError(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const numericError = invalidNumbers.size > 0;
  const canApply = dirty && !error && !numericError && pending.length === 0;
  const cancelTool = () => {
    setPending([]);
    setMessage(null);
    drag.current = null;
    drawing.current = false;
  };
  useModalFocus(expanded, () => {
    if (pending.length) cancelTool();
    else setExpanded(false);
  });
  const perform = (operation: () => Profile) => {
    try {
      const next = operation();
      for (const item of [...draft.outer, ...draft.holes, ...next.outer, ...next.holes])
        retiredIds.current.add(item.id);
      setDraft(next);
      setMessage(null);
      return next;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The sketch operation failed.');
    }
  };
  const draftReservedIds = () => [...retiredIds.current, ...reservedIds];
  const update = (change: (next: Profile) => void) =>
    perform(() => {
      const next = structuredClone(draft);
      change(next);
      return next;
    });
  const toSvg = (point: Point2): Point2 => [
    ((point[0] - view.left) / view.width) * 800,
    500 - ((point[1] - view.bottom) / view.height) * 500,
  ];
  const pointerPoint = (event: PointerEvent<SVGElement>): Point2 => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.current!.getScreenCTM();
    if (!matrix) return [view.left, view.bottom];
    const local = point.matrixTransform(matrix.inverse());
    const physical: Point2 = [
      view.left + (local.x / 800) * view.width,
      view.bottom + ((500 - local.y) / 500) * view.height,
    ];
    return snap ? snapPoint(physical, spacing) : physical;
  };
  const choose = (next: Selection) => {
    setSelection(next);
    if (next)
      onSelectBoundary(
        next.kind === 'hole' ? draft.holes[next.index].id : draft.outer[next.index].id,
      );
  };
  const closePolyline = () => {
    if (pending.length < 3) {
      setMessage('Add at least three vertices before closing the loop.');
      return;
    }
    perform(() => replaceSketchLoop(draft, pending, draftReservedIds()));
    setPending([]);
    setTool('select');
    setSelection(null);
  };
  const addPoint = (point: Point2) => {
    if (tool === 'polyline') {
      if (pending.length >= 64) {
        setMessage('Close the loop; a profile supports at most 64 edges.');
        return;
      }
      if (
        pending.length >= 3 &&
        Math.hypot(point[0] - pending[0][0], point[1] - pending[0][1]) < view.width / 70
      ) {
        closePolyline();
        return;
      }
      setPending([...pending, point]);
    } else if (tool === 'slot') {
      if (pending.length < 2) {
        if (
          pending.length &&
          Math.hypot(point[0] - pending[0][0], point[1] - pending[0][1]) < view.width * 1e-7
        ) {
          setMessage('Choose a distinct end center.');
          return;
        }
        setPending([...pending, point]);
        return;
      }
      const [a, b] = pending;
      const radius =
        Math.abs((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) /
        Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(radius > view.width * 1e-7)) {
        setMessage('Choose a side point away from the centerline.');
        return;
      }
      perform(() => slotSketchLoop(draft, a, b, radius, draftReservedIds()));
      setPending([]);
      setTool('select');
      setSelection(null);
    } else if (tool === 'rectangle' || tool === 'hole') {
      if (!pending.length) {
        setPending([point]);
        return;
      }
      const start = pending[0];
      if (Math.hypot(start[0] - point[0], start[1] - point[1]) < view.width * 1e-7) {
        setMessage('Choose a distinct second point.');
        return;
      }
      perform(() =>
        tool === 'rectangle'
          ? rectangleSketchLoop(draft, start, point, draftReservedIds())
          : addSketchHole(
              draft,
              start,
              Math.hypot(point[0] - start[0], point[1] - start[1]),
              draftReservedIds(),
            ),
      );
      setPending([]);
      setTool('select');
      setSelection(null);
    } else choose(null);
  };
  const moveHandle = (selected: NonNullable<Selection>, point: Point2) => {
    if (selected.kind === 'vertex') perform(() => moveSketchVertex(draft, selected.index, point));
    else if (selected.kind === 'hole')
      update((next) => {
        next.holes[selected.index].center = [...point];
      });
  };
  const startDrag = (event: PointerEvent<SVGElement>, next: NonNullable<Selection>) => {
    if (tool !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    choose(next);
    drag.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const grid = (spacing / view.width) * 800;
  const gridVisible = Number.isFinite(grid) && grid >= 4 && grid <= 400;
  const origin = toSvg([0, 0]);
  const selectedEdge = selection?.kind === 'edge' ? draft.outer[selection.index] : null;
  const splitSelected = () => {
    if (selection?.kind !== 'edge') return;
    const next = perform(() => splitSketchEdge(draft, selection.index, draftReservedIds()));
    if (next)
      setAssignmentNotice(
        'Edge split into two exact halves with new boundary IDs. Apply the sketch, then repair supports, loads and named boundaries that used the original edge.',
      );
  };
  const selectedPoint =
    selection?.kind === 'vertex'
      ? draft.outer[selection.index]?.start
      : selection?.kind === 'hole'
        ? draft.holes[selection.index]?.center
        : null;
  const selectedHole = selection?.kind === 'hole' ? draft.holes[selection.index] : null;
  const selectedName = selection
    ? selection.kind === 'hole'
      ? draft.holes[selection.index]?.name
      : draft.outer[selection.index]?.name
    : null;
  const displayCoordinate = (value: number) => Number((value * factor).toPrecision(14));
  const pointControl = (
    point: Point2,
    change: (value: number, axis: number) => void,
    prefix = '',
  ) => (
    <div className="form-grid">
      {(['X', 'Y'] as const).map((axis, index) => (
        <NumberInput
          key={`${prefix}${axis}`}
          label={`${prefix}${axis}`}
          value={displayCoordinate(point[index])}
          unit={unit}
          maximum={1000 * factor}
          onChange={(value) => change(value / factor, index)}
        />
      ))}
    </div>
  );
  const revert = () => {
    setDraft(structuredClone(profile));
    setSelection(null);
    cancelTool();
    setInvalidNumbers(new Map());
    setView(sketchBounds(profile));
    setAssignmentNotice(null);
    retiredIds.current = new Set([
      ...reservedIds,
      ...profile.outer.map((item) => item.id),
      ...profile.holes.map((item) => item.id),
    ]);
  };
  const apply = () => {
    if (canApply) {
      if (onApply(structuredClone(draft))) setExpanded(false);
    }
  };
  const content = (
    <NumericDraftContext.Provider value={reportNumericValidity}>
      <div className="sketch-toolbar" role="toolbar" aria-label="Sketch tools">
        {tools.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            title={label}
            onClick={() => {
              cancelTool();
              setTool(id);
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Split selected straight edge at midpoint"
          title="Split a straight edge into two exact halves. New boundary IDs require assignment repair after Apply."
          disabled={
            tool !== 'select' ||
            selectedEdge?.kind !== 'line' ||
            draft.outer.length >= 64 ||
            numericError ||
            pending.length > 0
          }
          onClick={splitSelected}
        >
          <Scissors size={14} />
          Split edge
        </button>
        <button
          type="button"
          title="Fit sketch"
          aria-label="Fit sketch"
          onClick={() => setView(sketchBounds(draft))}
        >
          <Focus size={14} />
        </button>
        {!expanded && (
          <button
            type="button"
            title="Expand sketch editor"
            aria-label="Expand sketch editor"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      <p className="sketch-tool-hint">{tools.find((item) => item.id === tool)!.hint}</p>
      <div className="sketch-work-area">
        <svg
          ref={svg}
          className={`sketch-canvas tool-${tool}`}
          viewBox="0 0 800 500"
          role="application"
          tabIndex={0}
          aria-label="Interactive plane profile sketch. Use toolbar tools to draw. Select handles and use arrow keys to move by the grid spacing. Escape cancels the active tool."
          onPointerDown={(event) => {
            if (event.button !== 0 || tool === 'select') return;
            drawing.current = true;
          }}
          onPointerMove={(event) => {
            const point = pointerPoint(event);
            setCursor(point);
            if (drag.current) moveHandle(drag.current, point);
          }}
          onPointerUp={(event) => {
            if (event.button !== 0) return;
            if (drag.current) {
              drag.current = null;
              return;
            }
            if (drawing.current) {
              drawing.current = false;
              addPoint(pointerPoint(event));
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            drawing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancelTool();
              setTool('select');
            } else if (event.key === 'Enter' && tool === 'polyline') {
              event.preventDefault();
              closePolyline();
            }
          }}
        >
          <title>
            Plane profile in {unit}; exact lines and circular arcs, with circular holes.
          </title>
          <defs>
            <pattern
              id={`grid-${gridId}`}
              width={gridVisible ? grid : 40}
              height={gridVisible ? grid : 40}
              patternUnits="userSpaceOnUse"
              x={origin[0]}
              y={origin[1]}
            >
              <path
                d={`M ${gridVisible ? grid : 40} 0 L 0 0 0 ${gridVisible ? grid : 40}`}
                className="sketch-grid"
                fill="none"
              />
            </pattern>
          </defs>
          <rect width="800" height="500" fill={`url(#grid-${gridId})`} />
          {origin[1] >= 0 && origin[1] <= 500 && (
            <line x1="0" x2="800" y1={origin[1]} y2={origin[1]} className="sketch-axis axis-x" />
          )}
          {origin[0] >= 0 && origin[0] <= 800 && (
            <line x1={origin[0]} x2={origin[0]} y1="0" y2="500" className="sketch-axis axis-y" />
          )}
          <path
            className={`sketch-fill ${error ? 'invalid' : ''}`}
            fillRule="evenodd"
            d={[
              `${draft.outer
                .flatMap((segment) => sampleSegment(segment).slice(0, -1))
                .map((point, index) => `${index === 0 ? 'M' : 'L'}${toSvg(point).join(',')}`)
                .join(' ')} Z`,
              ...draft.holes.map((hole) => {
                const [x, y] = toSvg(hole.center),
                  r = (hole.radius / view.width) * 800;
                return `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 Z`;
              }),
            ].join(' ')}
          />
          {draft.outer.map((segment, index) => (
            <g key={segment.id}>
              <polyline
                points={sampleSegment(segment)
                  .map((point) => toSvg(point).join(','))
                  .join(' ')}
                className={`sketch-edge ${selection?.kind === 'edge' && selection.index === index ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${segment.name}, ${segment.kind}, boundary ${segment.id}`}
                onPointerDown={(event) => {
                  if (tool !== 'select') return;
                  event.stopPropagation();
                  choose({ kind: 'edge', index });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    choose({ kind: 'edge', index });
                  }
                }}
              >
                <title>
                  {segment.name} · {segment.kind} · {segment.id}
                </title>
              </polyline>
            </g>
          ))}
          {draft.holes.map((hole, index) => {
            const [x, y] = toSvg(hole.center);
            return (
              <g key={hole.id}>
                <circle
                  cx={x}
                  cy={y}
                  r={(hole.radius / view.width) * 800}
                  className={`sketch-edge ${selection?.kind === 'hole' && selection.index === index ? 'selected' : ''}`}
                  onPointerDown={(event) => {
                    if (tool !== 'select') return;
                    event.stopPropagation();
                    choose({ kind: 'hole', index });
                  }}
                >
                  <title>
                    {hole.name} · {hole.id}
                  </title>
                </circle>
                <circle
                  cx={x}
                  cy={y}
                  r="6"
                  className="sketch-handle hole"
                  role="button"
                  tabIndex={0}
                  aria-label={`Move center of ${hole.name}`}
                  onPointerDown={(event) => startDrag(event, { kind: 'hole', index })}
                  onKeyDown={(event) => {
                    const steps: Record<string, Point2> = {
                      ArrowLeft: [-spacing, 0],
                      ArrowRight: [spacing, 0],
                      ArrowUp: [0, spacing],
                      ArrowDown: [0, -spacing],
                    };
                    const delta = steps[event.key];
                    if (delta) {
                      event.preventDefault();
                      moveHandle({ kind: 'hole', index }, [
                        hole.center[0] + delta[0],
                        hole.center[1] + delta[1],
                      ]);
                    } else if (event.key === 'Enter') choose({ kind: 'hole', index });
                  }}
                />
              </g>
            );
          })}
          {draft.outer.map((segment, index) => {
            const [x, y] = toSvg(segment.start);
            return (
              <circle
                key={`vertex:${segment.id}`}
                cx={x}
                cy={y}
                r="6"
                className={`sketch-handle ${selection?.kind === 'vertex' && selection.index === index ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Move vertex ${index + 1} at ${formatValue(segment.start[0] * factor)}, ${formatValue(segment.start[1] * factor)} ${unit}`}
                onPointerDown={(event) => startDrag(event, { kind: 'vertex', index })}
                onKeyDown={(event) => {
                  const steps: Record<string, Point2> = {
                    ArrowLeft: [-spacing, 0],
                    ArrowRight: [spacing, 0],
                    ArrowUp: [0, spacing],
                    ArrowDown: [0, -spacing],
                  };
                  const delta = steps[event.key];
                  if (delta) {
                    event.preventDefault();
                    choose({ kind: 'vertex', index });
                    moveHandle({ kind: 'vertex', index }, [
                      segment.start[0] + delta[0],
                      segment.start[1] + delta[1],
                    ]);
                  } else if (event.key === 'Enter') choose({ kind: 'vertex', index });
                }}
              />
            );
          })}
          {pending.length > 0 && (
            <>
              <polyline
                points={[...pending, ...(cursor ? [cursor] : [])]
                  .map((point) => toSvg(point).join(','))
                  .join(' ')}
                className="sketch-preview"
              />
              {pending.map((point, index) => {
                const [x, y] = toSvg(point);
                return <circle key={index} cx={x} cy={y} r="5" className="sketch-pending-point" />;
              })}
              {cursor &&
                tool === 'rectangle' &&
                (() => {
                  const [a, b] = [toSvg(pending[0]), toSvg(cursor)];
                  return (
                    <rect
                      x={Math.min(a[0], b[0])}
                      y={Math.min(a[1], b[1])}
                      width={Math.abs(a[0] - b[0])}
                      height={Math.abs(a[1] - b[1])}
                      className="sketch-preview"
                    />
                  );
                })()}
              {cursor &&
                tool === 'hole' &&
                (() => {
                  const [x, y] = toSvg(pending[0]);
                  return (
                    <circle
                      cx={x}
                      cy={y}
                      r={
                        (Math.hypot(cursor[0] - pending[0][0], cursor[1] - pending[0][1]) /
                          view.width) *
                        800
                      }
                      className="sketch-preview"
                    />
                  );
                })()}
            </>
          )}
          <text x="16" y="26" className="sketch-coordinate">
            {cursor
              ? `X ${formatValue(cursor[0] * factor)} · Y ${formatValue(cursor[1] * factor)} ${unit}`
              : `XY plane · ${unit}`}
          </text>
        </svg>
        <div className="sketch-selection-controls">
          <div className="sketch-snap">
            <label>
              <input
                type="checkbox"
                checked={snap}
                onChange={(event) => setSnap(event.target.checked)}
              />{' '}
              Snap to grid
            </label>
            <NumberInput
              label="Grid spacing"
              value={displayCoordinate(spacing)}
              unit={unit}
              positive
              physical={false}
              onChange={(value) => setSpacing(value / factor)}
            />
          </div>
          {selection && selectedName ? (
            <>
              <strong>
                {selection.kind === 'vertex' ? `Vertex ${selection.index + 1} · ` : ''}
                {selectedName}
              </strong>
              {selectedPoint &&
                pointControl(selectedPoint, (value, axis) => {
                  const point = [...selectedPoint] as Point2;
                  point[axis] = value;
                  moveHandle(selection, point);
                })}
              {selectedHole && (
                <NumberInput
                  label="Hole radius"
                  value={displayCoordinate(selectedHole.radius)}
                  unit={unit}
                  positive
                  maximum={1000 * factor}
                  onChange={(value) =>
                    update((next) => {
                      next.holes[selection.index].radius = value / factor;
                    })
                  }
                />
              )}
              {selectedEdge && (
                <>
                  <label className="field-label">
                    <span>Boundary name</span>
                    <input
                      maxLength={200}
                      value={selectedEdge.name}
                      onChange={(event) =>
                        update((next) => {
                          next.outer[selection.index].name = event.target.value;
                        })
                      }
                    />
                  </label>
                  <label className="field-label">
                    <span>Curve</span>
                    <Select
                      aria-label="Curve"
                      value={selectedEdge.kind}
                      options={[
                        { value: 'line', label: 'Straight line' },
                        { value: 'arc', label: 'Circular arc' },
                      ]}
                      onChange={(value) =>
                        update((next) => {
                          const edge = next.outer[selection.index];
                          edge.kind = value as 'line' | 'arc';
                          if (edge.kind === 'arc') {
                            edge.center = [
                              (edge.start[0] + edge.end[0]) / 2,
                              (edge.start[1] + edge.end[1]) / 2,
                            ];
                            edge.clockwise = false;
                          } else {
                            delete edge.center;
                            delete edge.clockwise;
                          }
                        })
                      }
                    />
                  </label>
                  {selectedEdge.kind === 'arc' && selectedEdge.center && (
                    <>
                      <NumberInput
                        label="Arc radius"
                        value={
                          Math.hypot(
                            selectedEdge.start[0] - selectedEdge.center[0],
                            selectedEdge.start[1] - selectedEdge.center[1],
                          ) * factor
                        }
                        unit={unit}
                        positive
                        maximum={1000 * factor}
                        onChange={(value) =>
                          update((next) => setArcRadius(next, selection.index, value / factor))
                        }
                      />
                      {pointControl(
                        selectedEdge.center,
                        (value, axis) =>
                          update((next) => {
                            next.outer[selection.index].center![axis] = value;
                          }),
                        'Center ',
                      )}
                      <label className="field-label">
                        <span>Arc direction</span>
                        <Select
                          aria-label="Arc direction"
                          value={selectedEdge.clockwise ? 'cw' : 'ccw'}
                          options={[
                            { value: 'ccw', label: 'Counterclockwise' },
                            { value: 'cw', label: 'Clockwise' },
                          ]}
                          onChange={(value) =>
                            update((next) => {
                              next.outer[selection.index].clockwise = value === 'cw';
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  <small className="property-hint">Boundary ID: {selectedEdge.id}</small>
                </>
              )}
            </>
          ) : (
            <p className="property-hint">
              Select geometry to edit its exact coordinates. Linked endpoints move together. Review
              arc centers and radii after moving a shared vertex.
            </p>
          )}
        </div>
      </div>
      <div className="sketch-pending-actions">
        {tool === 'polyline' && pending.length > 0 && (
          <>
            <span>{pending.length} vertices</span>
            <button type="button" disabled={pending.length < 3} onClick={closePolyline}>
              Close loop
            </button>
            <button type="button" onClick={() => setPending(pending.slice(0, -1))}>
              Undo point
            </button>
            <button type="button" onClick={cancelTool}>
              Cancel
            </button>
          </>
        )}
      </div>
      <div
        className={`sketch-validation ${error || numericError || message ? 'invalid' : ''}`}
        role="status"
      >
        {message ??
          (numericError
            ? 'Complete or revert the selected numeric input before applying.'
            : (error ??
              (dirty ? 'Valid closed profile · changes ready to apply' : 'Valid closed profile')))}
      </div>
      {assignmentNotice && (
        <p className="sketch-assignment-notice" role="status">
          {assignmentNotice}
        </p>
      )}
      <div className="sketch-draft-actions">
        <span>{dirty ? 'Unapplied sketch' : 'Applied geometry'}</span>
        <button type="button" disabled={!dirty && !pending.length} onClick={revert}>
          <RotateCcw size={13} />
          Revert
        </button>
        <button type="button" className="primary" disabled={!canApply} onClick={apply}>
          <Check size={13} />
          Apply sketch
        </button>
      </div>
    </NumericDraftContext.Provider>
  );
  return (
    <div className="profile-sketch">
      <p className="property-hint">
        Draft on the XY plane; Apply records one geometry edit. Leaving Geometry discards unapplied
        changes. Replacing the loop requires boundary assignment repair.
      </p>
      {expanded ? (
        <div className="modal-backdrop">
          <section
            className="modal sketch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`sketch-title-${gridId}`}
          >
            <header>
              <div>
                <h2 id={`sketch-title-${gridId}`}>Edit plane profile</h2>
                <p>Exact lines, circular arcs and circular holes · {unit}</p>
              </div>
              <button
                type="button"
                aria-label="Collapse sketch editor"
                onClick={() => setExpanded(false)}
              >
                <X size={18} />
              </button>
            </header>
            {content}
          </section>
        </div>
      ) : (
        content
      )}
    </div>
  );
}
