import { describe, expect, it } from 'vitest';
import type { CadSketchDefinition, Point2 } from '../../domain/contracts/project.generated';
import {
  addSketchCircle,
  addSketchLine,
  addSketchRectangle,
  addSketchThreePointArc,
  deleteSketchSelection,
  entityPoints,
  fitSketchView,
  formatSketchNumber,
  lineDimensionPosition,
  moveSketchPoint,
  sketchReadiness,
  snapSketchPoint,
  threePointArc,
} from './sketchInteractions';
const empty = (): CadSketchDefinition => ({ points: [], entities: [], constraints: [], loops: [] });
const at = (position: Point2) => ({ position, kind: 'none' as const });
describe('direct authored sketch interactions', () => {
  it('formats solver noise without modifying the authoritative SI coordinates', () => {
    const coordinate = [0.039999999999999994, 3.469446951953614e-18] as Point2;
    const before = [...coordinate];
    expect(formatSketchNumber(coordinate[0] * 1000, 200)).toBe('40');
    expect(formatSketchNumber(coordinate[1] * 1000, 200)).toBe('0');
    expect(coordinate).toEqual(before);
    expect(formatSketchNumber(1e-10, 1e-6)).toBe('1e-10');
  });
  it('keeps input immutable and reuses the actual snapped endpoint identity', () => {
    const first = addSketchLine(empty(), at([0, 0]), at([0.1, 0]));
    const line = first.entities[0];
    expect(line.kind).toBe('line');
    if (line.kind !== 'line') return;
    const snap = snapSketchPoint(first, [0.1001, 0], 0.001, 0.01);
    expect(snap.pointId).toBe(line.endId);
    const second = addSketchLine(first, snap, at([0.1, 0.05]));
    expect(first.entities).toHaveLength(1);
    expect(second.points).toHaveLength(3);
    expect(second.entities[1]).toMatchObject({ startId: line.endId });
    expect(sketchReadiness(second)).toMatchObject({ openEntities: 2, closedLoops: 0 });
  });
  it('creates one closed SI rectangle with real horizontal and vertical constraints', () => {
    const source = empty(),
      rectangle = addSketchRectangle(source, at([0, 0]), at([0.1, 0.05]));
    expect(source.points).toHaveLength(0);
    expect(rectangle.points).toHaveLength(4);
    expect(rectangle.constraints.map((item) => item.kind)).toEqual([
      'horizontal',
      'vertical',
      'horizontal',
      'vertical',
    ]);
    expect(rectangle.loops[0].entityIds).toHaveLength(4);
    expect(sketchReadiness(rectangle)).toEqual({ closedLoops: 1, openEntities: 0, issue: null });
  });
  it('places contour length labels outside each side without altering geometry', () => {
    const sketch = addSketchRectangle(empty(), at([0, 0]), at([0.1, 0.05]));
    const labels = sketch.entities.map((entity) => lineDimensionPosition(sketch, entity, 0.01));
    expect(labels[0][1]).toBeLessThan(0);
    expect(labels[1][0]).toBeGreaterThan(0.1);
    expect(labels[2][1]).toBeGreaterThan(0.05);
    expect(labels[3][0]).toBeLessThan(0);
    expect(sketch.points[0].position).toEqual([0, 0]);
  });
  it('detects closure by shared references across individually drawn lines', () => {
    let sketch = addSketchLine(empty(), at([0, 0]), at([0.1, 0]));
    const first = sketch.entities[0];
    if (first.kind !== 'line') return;
    sketch = addSketchLine(sketch, { ...at([0.1, 0]), pointId: first.endId }, at([0, 0.1]));
    const second = sketch.entities[1];
    if (second.kind !== 'line') return;
    sketch = addSketchLine(
      sketch,
      { ...at([0, 0.1]), pointId: second.endId },
      { ...at([0, 0]), pointId: first.startId },
    );
    expect(sketch.loops).toHaveLength(1);
    expect(sketch.loops[0].entityIds).toHaveLength(3);
  });
  it('classifies a newly drawn enclosed circle as a hole without changing prior loop identity', () => {
    const rectangle = addSketchRectangle(empty(), at([-0.1, -0.1]), at([0.1, 0.1]));
    const sketch = addSketchCircle(rectangle, at([0, 0]), [0.02, 0]);
    expect(sketch.loops[0]).toEqual(rectangle.loops[0]);
    expect(sketch.loops[1].role).toBe('hole');
    expect(sketchReadiness(sketch).issue).toBeNull();
  });
  it('does not silently reassign an existing outer loop when another enclosing outline is added', () => {
    const circle = addSketchCircle(empty(), at([0, 0]), [0.02, 0]);
    const sketch = addSketchRectangle(circle, at([-0.1, -0.1]), at([0.1, 0.1]));
    expect(sketch.loops.filter((loop) => loop.role === 'outer')).toHaveLength(2);
    expect(sketchReadiness(sketch).issue).toContain('exactly one');
  });
  it('retains authored loop identities and roles when a hole center is moved', () => {
    const rectangle = addSketchRectangle(empty(), at([-0.1, -0.1]), at([0.1, 0.1]));
    const sketch = addSketchCircle(rectangle, at([0, 0]), [0.02, 0]);
    const circle = sketch.entities.at(-1)!;
    if (circle.kind !== 'circle') return;
    const moved = moveSketchPoint(sketch, circle.centerId, [0.03, 0.02]);
    expect(moved.loops).toEqual(sketch.loops);
  });
  it('supports a nested closed line loop as a native CAD hole', () => {
    const outer = addSketchRectangle(empty(), at([-0.1, -0.1]), at([0.1, 0.1]));
    const sketch = addSketchRectangle(outer, at([-0.02, -0.02]), at([0.02, 0.02]));
    expect(sketch.loops.map((loop) => loop.role)).toEqual(['outer', 'hole']);
    expect(sketchReadiness(sketch).issue).toBeNull();
  });
  it('constructs an exact three-point semicircle and preserves equal endpoint radius when dragging', () => {
    const sketch = addSketchThreePointArc(empty(), at([0, 0]), [0.05, 0.05], at([0.1, 0]));
    const arc = sketch.entities[0];
    if (arc.kind !== 'arc') return;
    expect(arc.clockwise).toBe(true);
    const center = sketch.points.find((point) => point.id === arc.centerId)!.position;
    expect(center[0]).toBeCloseTo(0.05, 12);
    expect(center[1]).toBeCloseTo(0, 12);
    expect(entityPoints(sketch, arc)[16][1]).toBeCloseTo(0.05, 12);
    const moved = moveSketchPoint(sketch, arc.endId, [0.2, 0.02]);
    const a = moved.points.find((point) => point.id === arc.startId)!.position,
      b = moved.points.find((point) => point.id === arc.endId)!.position,
      c = moved.points.find((point) => point.id === arc.centerId)!.position;
    expect(Math.hypot(a[0] - c[0], a[1] - c[1])).toBeCloseTo(
      Math.hypot(b[0] - c[0], b[1] - c[1]),
      12,
    );
  });
  it('rejects collinear arc picks and computes small distant arcs without catastrophic cancellation', () => {
    expect(() => threePointArc([0, 0], [0.05, 0], [0.1, 0])).toThrow('straight line');
    const arc = threePointArc([999, 999], [999.0005, 999.0005], [999.001, 999]);
    expect(arc.center[0]).toBeCloseTo(999.0005, 9);
    expect(arc.center[1]).toBeCloseTo(999, 9);
  });
  it('protects authored constraint references on deletion', () => {
    const sketch = addSketchRectangle(empty(), at([0, 0]), at([0.1, 0.05]));
    expect(() =>
      deleteSketchSelection(sketch, [{ kind: 'entity', id: sketch.entities[0].id }]),
    ).toThrow('constraint');
    const unconstrained = { ...sketch, constraints: [] };
    const removed = deleteSketchSelection(unconstrained, [
      { kind: 'entity', id: sketch.entities[0].id },
    ]);
    expect(removed.loops).toHaveLength(0);
    expect(removed.entities).toHaveLength(3);
    expect(sketch.entities).toHaveLength(4);
  });
  it('keeps constraints unchanged when moving a point; solver reconciliation remains explicit', () => {
    const sketch = addSketchRectangle(empty(), at([0, 0]), at([0.1, 0.05]));
    const moved = moveSketchPoint(sketch, sketch.points[0].id, [-0.01, 0]);
    expect(moved.constraints).toEqual(sketch.constraints);
    expect(moved.points[0].id).toBe(sketch.points[0].id);
  });
  it('requires explicit removal of a fixed anchor before any point move', () => {
    const sketch = addSketchLine(empty(), at([0, 0]), at([0.1, 0]));
    sketch.constraints.push({ id: 'fixed', kind: 'fixedPoint', pointId: sketch.points[0].id });
    expect(() => moveSketchPoint(sketch, sketch.points[0].id, [0.01, 0])).toThrow('fixed');
    const unfixed = { ...sketch, constraints: [] };
    expect(moveSketchPoint(unfixed, sketch.points[0].id, [0.01, 0]).points[0].position).toEqual([
      0.01, 0,
    ]);
  });
  it('does not move a fixed arc center indirectly while dragging its endpoint', () => {
    const sketch = addSketchThreePointArc(empty(), at([0, 0]), [0.05, 0.05], at([0.1, 0]));
    const arc = sketch.entities[0];
    if (arc.kind !== 'arc') return;
    sketch.constraints.push({ id: 'fixed-center', kind: 'fixedPoint', pointId: arc.centerId });
    expect(() => moveSketchPoint(sketch, arc.endId, [0.2, 0])).toThrow('fixed');
  });
  it('deleting a curve preserves unrelated standalone authored points', () => {
    const sketch = addSketchLine(empty(), at([0, 0]), at([0.1, 0]));
    sketch.points.push({ id: 'unrelated-point', position: [0.2, 0.2] });
    const next = deleteSketchSelection(sketch, [{ kind: 'entity', id: sketch.entities[0].id }]);
    expect(next.points).toEqual([{ id: 'unrelated-point', position: [0.2, 0.2] }]);
  });
  it('prioritizes endpoints and origin, then exposes horizontal/vertical inference', () => {
    expect(snapSketchPoint(empty(), [0.0001, 0.0002], 0.001, 0.01).kind).toBe('origin');
    expect(snapSketchPoint(empty(), [0.045, 0.10001], 0.001, 0.01, [0.01, 0.1])).toMatchObject({
      position: [0.05, 0.1],
      kind: 'horizontal',
    });
    expect(snapSketchPoint(empty(), [0.0101, 0.045], 0.001, 0.01, [0.01, 0.1])).toMatchObject({
      position: [0.01, 0.05],
      kind: 'vertical',
    });
  });
  it('fits the full circle rather than only its authored center point', () => {
    const sketch = addSketchCircle(empty(), at([0, 0]), [0.1, 0]);
    const view = fitSketchView(sketch, 2);
    expect(view.height).toBeGreaterThan(0.2);
    expect(view.width / view.height).toBe(2);
  });
});
