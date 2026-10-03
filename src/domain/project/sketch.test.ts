import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import { inputError } from './validation';
import { profileError, rectangularProfile } from './profile';
import {
  addSketchHole,
  moveSketchVertex,
  rectangleSketchLoop,
  replaceSketchLoop,
  sketchBounds,
  snapPoint,
  slotSketchLoop,
} from './sketch';

const rectangle = () => ({ ...rectangularProfile(2, 1), holes: [] });
describe('bounded plane sketch editing', () => {
  it('moves both sides of a shared vertex without mutating the definition or boundary identities', () => {
    const source = rectangle();
    const next = moveSketchVertex(source, 1, [2.5, 0]);
    expect(source.outer[1].start).toEqual([2, 0]);
    expect(next.outer[0].end).toEqual([2.5, 0]);
    expect(next.outer[1].start).toEqual([2.5, 0]);
    expect(next.outer.map((item) => item.id)).toEqual(['y0', 'x1', 'y1', 'x0']);
    expect(profileError(next)).toBe(null);
    const origin = moveSketchVertex(next, 0, [-0.5, -0.25]);
    expect(origin.outer.at(-1)!.end).toEqual(origin.outer[0].start);
    expect(() => moveSketchVertex(source, 0, [Infinity, 0])).toThrow('finite');
    expect(() => moveSketchVertex(source, 0, [1001, 0])).toThrow('1,000');
  });
  it('retains exact arc identity while independently rejecting an infeasible moved endpoint', () => {
    const source = makeProject('kirsch-quarter').geometry.profile!;
    const draft = moveSketchVertex(source, 1, [-0.8, 0]);
    expect(draft.outer[1].id).toBe('hole');
    expect(draft.outer[0].end).toEqual(draft.outer[1].start);
    expect(profileError(draft)).toMatch(/same positive distance/);
    expect(source.outer[1].start).toEqual([-1, 0]);
  });
  it('builds a counterclockwise rectangle from either drag direction and reserves deleted assignment IDs', () => {
    const source = rectangle();
    const next = rectangleSketchLoop(source, [3, 2], [-1, -1], ['edge-1', 'edge-3']);
    expect(next.outer.map((item) => item.start)).toEqual([
      [-1, -1],
      [3, -1],
      [3, 2],
      [-1, 2],
    ]);
    expect(next.outer.map((item) => item.id)).toEqual(['edge-2', 'edge-4', 'edge-5', 'edge-6']);
    expect(profileError(next)).toBe(null);
    expect(source.outer[0].start).toEqual([0, 0]);
    const project = makeProject('kirsch-quarter');
    project.geometry.profile = next;
    expect(project.study.loads[0].regions).toEqual(['x1', 'y1']);
    expect(inputError(project)).toMatch(/deleted or renamed/);
  });
  it('normalizes clockwise polygon traversal and exposes crossings and flat loops through exact validation', () => {
    const source = rectangle();
    const next = replaceSketchLoop(
      source,
      [
        [0, 0],
        [0, 1],
        [2, 1],
        [2, 0],
      ],
      [],
    );
    expect(profileError(next)).toBe(null);
    const crossing = replaceSketchLoop(
      source,
      [
        [0, 0],
        [2, 1],
        [0, 1],
        [2, 0],
      ],
      [],
    );
    expect(profileError(crossing)).toMatch(/intersect or overlap/);
    expect(profileError(rectangleSketchLoop(source, [0, 0], [2, 0], []))).toMatch(
      /too small or thin/,
    );
    expect(() =>
      replaceSketchLoop(
        source,
        [
          [0, 0],
          [1, 0],
        ],
        [],
      ),
    ).toThrow('3–64');
    expect(() =>
      replaceSketchLoop(
        source,
        Array.from({ length: 65 }, (_, i) => [i, i % 2]),
        [],
      ),
    ).toThrow('3–64');
  });
  it('adds exact circular holes with bounded new identities and leaves containment to the validator', () => {
    const source = rectangle();
    const next = addSketchHole(source, [1, 0.5], 0.2, ['hole-1']);
    expect(next.holes[0]).toMatchObject({ id: 'hole-2', center: [1, 0.5], radius: 0.2 });
    expect(source.holes).toEqual([]);
    expect(profileError(next)).toBe(null);
    expect(profileError(addSketchHole(next, [0, 0], 0.2, []))).toMatch(/strictly inside/);
    const full = {
      ...source,
      holes: Array.from({ length: 16 }, (_, i) => ({
        id: `h-${i}`,
        name: 'Hole',
        center: [1, 0.5] as [number, number],
        radius: 0.1,
      })),
    };
    expect(() => addSketchHole(full, [1, 0.5], 0.2, [])).toThrow('16');
    expect(() => addSketchHole(source, [0, 0], NaN, [])).toThrow('finite');
  });
  it('snaps in SI without altering the input and frames translated exact arcs and circular holes', () => {
    const point: [number, number] = [0.00124, -0.00226];
    expect(snapPoint(point, 0.0001)).toEqual([0.0012000000000000001, -0.0023]);
    expect(point).toEqual([0.00124, -0.00226]);
    const source = makeProject('kirsch-quarter').geometry.profile!;
    const bounds = sketchBounds(source);
    for (const edge of source.outer)
      for (const point of [edge.start, edge.end]) {
        expect(point[0]).toBeGreaterThanOrEqual(bounds.left);
        expect(point[0]).toBeLessThanOrEqual(bounds.left + bounds.width);
        expect(point[1]).toBeGreaterThanOrEqual(bounds.bottom);
        expect(point[1]).toBeLessThanOrEqual(bounds.bottom + bounds.height);
      }
    expect(bounds.width / bounds.height).toBeCloseTo(1.6);
  });
});

describe('exact slot profiles', () => {
  it('creates tangent semicircular ends at arbitrary orientation without reusing assigned IDs', () => {
    for (const end of [
      [2, 0],
      [0, 2],
      [2, 2],
      [-2, -1],
    ] as [number, number][]) {
      const source = rectangle();
      const slot = slotSketchLoop(source, [0, 0], end, 0.25, ['edge-1']);
      expect(profileError(slot)).toBeNull();
      expect(slot.outer.map((edge) => edge.kind)).toEqual(['line', 'arc', 'line', 'arc']);
      expect(slot.outer[1].center).toEqual(end);
      expect(slot.outer[3].center).toEqual([0, 0]);
      expect(slot.outer[0].id).toBe('edge-2');
      expect(source).toEqual(rectangle());
      for (const index of [1, 3]) {
        const arc = slot.outer[index];
        expect(
          Math.hypot(arc.start[0] - arc.center![0], arc.start[1] - arc.center![1]),
        ).toBeCloseTo(0.25);
        const line = slot.outer[(index + 3) % 4];
        const tangent = [line.end[0] - line.start[0], line.end[1] - line.start[1]];
        const radial = [arc.start[0] - arc.center![0], arc.start[1] - arc.center![1]];
        expect(tangent[0] * radial[0] + tangent[1] * radial[1]).toBeCloseTo(0);
      }
    }
  });
  it('rejects zero length/radius, nonfinite points and out-of-bounds extents', () => {
    for (const radius of [0, -1, Infinity])
      expect(() => slotSketchLoop(rectangle(), [0, 0], [1, 0], radius, [])).toThrow();
    expect(() => slotSketchLoop(rectangle(), [0, 0], [0, 0], 0.1, [])).toThrow('distinct');
    expect(() => slotSketchLoop(rectangle(), [0, Infinity], [1, 0], 0.1, [])).toThrow('finite');
    expect(() => slotSketchLoop(rectangle(), [999.9, 0], [1000, 0], 1, [])).toThrow('extents');
  });
});
