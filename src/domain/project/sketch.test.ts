import { describe, expect, it } from 'vitest';
import type { Profile } from '../contracts/project.generated';
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
  splitSketchEdge,
} from './sketch';

const rectangle = (): Profile => ({ ...rectangularProfile(2, 1), holes: [] });
describe('bounded plane sketch editing', () => {
  it('splits a straight edge at its exact midpoint and preserves the surrounding closed SI geometry', () => {
    const source = rectangle();
    const next = splitSketchEdge(source, 2, ['edge-1', 'edge-3']);
    expect(next.outer[2]).toMatchObject({ id: 'edge-2', start: [2, 1], end: [1, 1], kind: 'line' });
    expect(next.outer[3]).toMatchObject({ id: 'edge-4', start: [1, 1], end: [0, 1], kind: 'line' });
    expect(next.outer[2].end).toEqual(next.outer[3].start);
    expect(next.outer[1].end).toEqual(next.outer[2].start);
    expect(next.outer[3].end).toEqual(next.outer[4].start);
    expect(next.outer.map((edge) => edge.id)).toEqual(['y0', 'x1', 'edge-2', 'edge-4', 'x0']);
    expect(profileError(next)).toBeNull();
    expect(source).toEqual(rectangle());
    const area = (profile: typeof source) =>
      profile.outer.reduce(
        (sum, edge) => sum + (edge.start[0] * edge.end[1] - edge.end[0] * edge.start[1]) / 2,
        0,
      );
    expect(area(next)).toBe(area(source));
    expect(next.outer[2].end).not.toBe(next.outer[3].start);
  });
  it('handles diagonal and closing edges while reserving hole and retired boundary identities', () => {
    const source = replaceSketchLoop(
      rectangle(),
      [
        [-2, -1],
        [2, 1],
        [1, 3],
      ],
      [],
    );
    source.holes.push({ id: 'edge-4', name: 'Reserved hole', center: [0, 1], radius: 0.1 });
    const next = splitSketchEdge(source, 0, ['edge-5', 'edge-6']);
    expect(next.outer[0]).toMatchObject({ id: 'edge-7', start: [-2, -1], end: [0, 0] });
    expect(next.outer[1]).toMatchObject({ id: 'edge-8', start: [0, 0], end: [2, 1] });
    expect(next.holes).toEqual(source.holes);
    const closing = splitSketchEdge(rectangle(), 3, []);
    expect(closing.outer.at(-1)!.end).toEqual(closing.outer[0].start);
    expect(profileError(closing)).toBeNull();
    const originalName = 'A'.repeat(200);
    source.outer[0].name = originalName;
    expect(splitSketchEdge(source, 0, []).outer[0].name).toHaveLength(200);
  });
  it('requires explicit repair of assignments to the retired edge after applying a split', () => {
    const project = makeProject('kirsch-quarter');
    const index = project.geometry.profile!.outer.findIndex((edge) => edge.id === 'x1');
    const originalAssignments = structuredClone(project.study.loads);
    project.geometry.profile = splitSketchEdge(
      project.geometry.profile!,
      index,
      project.study.loads.flatMap((item) => item.regions),
    );
    expect(project.study.loads).toEqual(originalAssignments);
    expect(inputError(project)).toMatch(/deleted or renamed/);
  });
  it('enforces the 64-edge resource bound and declines arcs, missing selections and unrepresentable halves', () => {
    const regular = (count: number) =>
      replaceSketchLoop(
        rectangle(),
        Array.from({ length: count }, (_, index) => [
          Math.cos((2 * Math.PI * index) / count),
          Math.sin((2 * Math.PI * index) / count),
        ]),
        [],
      );
    const next = splitSketchEdge(regular(63), 0, []);
    expect(next.outer).toHaveLength(64);
    expect(profileError(next)).toBeNull();
    expect(() => splitSketchEdge(regular(64), 0, [])).toThrow('64');
    const arc = makeProject('kirsch-quarter').geometry.profile!;
    expect(() => splitSketchEdge(arc, 1, [])).toThrow('Only straight');
    for (const index of [-1, 4, NaN, 0.5])
      expect(() => splitSketchEdge(rectangle(), index, [])).toThrow('existing straight');
    const collapsed = rectangle();
    collapsed.outer[0].end = [...collapsed.outer[0].start];
    expect(() => splitSketchEdge(collapsed, 0, [])).toThrow('too short');
    collapsed.outer[0].start[0] = Infinity;
    expect(() => splitSketchEdge(collapsed, 0, [])).toThrow('finite');
  });
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
