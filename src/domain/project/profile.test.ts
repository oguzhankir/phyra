import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '../../../contracts/project.schema.json';
import { makeProject } from '../../features/examples/projects';
import { changeStudySolver, supportsPinn } from './study';
import {
  profileError,
  rectangularProfile,
  sampleSegment,
  setArcRadius,
  freshBoundaryId,
  changeGeometryKind,
} from './profile';
import { regionNames } from './regions';
import { selectionIsCompatible } from './namedSelections';
import { inputError } from './validation';
import { resultIsCurrent } from '../execution/presentation';
import type { ResultData } from '../results/fields';

const validate = new Ajv({ strict: true }).compile(schema);
describe('exact plane-stress profiles', () => {
  it('constructs the bounded quarter circle with exact radius and clockwise cutout', () => {
    const project = makeProject('kirsch-quarter');
    expect(validate(project), JSON.stringify(validate.errors)).toBe(true);
    expect(inputError(project)).toBe(null);
    const profile = project.geometry.profile!;
    const cutout = profile.outer.find((segment) => segment.id === 'hole')!;
    const preview = sampleSegment(cutout);
    expect(preview.length).toBeGreaterThan(2);
    for (const point of preview) expect(Math.hypot(...point)).toBeCloseTo(1, 12);
    expect(preview[0][0]).toBeCloseTo(-1, 12);
    expect(preview.at(-1)![1]).toBeCloseTo(1, 12);
    expect(project.study.constraints.map((item) => item.components)).toEqual([
      [null, 0, null],
      [0, null, null],
    ]);
    expect(project.study.loads[0].traction).toEqual({
      kind: 'kirsch',
      radius: 1,
      center: [0, 0],
      tension: 0.5,
    });
  });
  it('changes an arc radius with shared endpoints and stable identities, without altering load parameters', () => {
    const project = makeProject('kirsch-quarter');
    setArcRadius(project.geometry.profile!, 1, 0.75);
    const edges = project.geometry.profile!.outer;
    expect(edges[0].end).toEqual([-0.75, 0]);
    expect(edges[1].start).toEqual([-0.75, 0]);
    expect(edges[1].end).toEqual([0, 0.75]);
    expect(edges[2].start).toEqual([0, 0.75]);
    expect(edges.map((edge) => edge.id)).toEqual(['y0', 'hole', 'x0', 'y1', 'x1']);
    expect(inputError(project)).toBe(null);
    expect(
      project.study.loads[0].traction!.kind === 'kirsch' && project.study.loads[0].traction!.radius,
    ).toBe(1);
    expect(() => setArcRadius(project.geometry.profile!, 1, 0)).toThrow('positive');
  });
  it('accepts a numeric rectangle with an enclosed circular hole and a two-arc disk', () => {
    expect(profileError(rectangularProfile(2, 1))).toBe(null);
    expect(
      profileError({
        outer: [
          {
            id: 'upper',
            name: 'Upper half',
            kind: 'arc',
            start: [1, 0],
            end: [-1, 0],
            center: [0, 0],
            clockwise: false,
          },
          {
            id: 'lower',
            name: 'Lower half',
            kind: 'arc',
            start: [-1, 0],
            end: [1, 0],
            center: [0, 0],
            clockwise: false,
          },
        ],
        holes: [{ id: 'inside', name: 'Inner circle', center: [0, 0], radius: 0.2 }],
      }),
    ).toBe(null);
  });
  it('validates shape independently of its SI scale and translation, without accepting thin or degenerate domains', () => {
    for (const scale of [1e-30, 1e-10, 1e-3, 100])
      expect(profileError(rectangularProfile(2 * scale, scale))).toBe(null);
    const translated = rectangularProfile(2e-5, 1e-5);
    for (const segment of translated.outer) {
      segment.start = [segment.start[0] + 900, segment.start[1] - 700];
      segment.end = [segment.end[0] + 900, segment.end[1] - 700];
    }
    translated.holes[0].center = [
      translated.holes[0].center[0] + 900,
      translated.holes[0].center[1] - 700,
    ];
    expect(profileError(translated)).toBe(null);
    expect(profileError(rectangularProfile(1, 1e-7))).toMatch(/too small or thin/);
    expect(profileError(rectangularProfile(1e-91, 1e-91))).toMatch(/too small or thin/);
  });
  it('rejects open loops, unequal arc radii, and a crossing outer edge', () => {
    const project = makeProject('kirsch-quarter');
    const profile = project.geometry.profile!;
    profile.outer[0].end[0] = -0.9;
    expect(profileError(profile)).toMatch(/outer loop is open/);
    profile.outer[0].end[0] = -1;
    profile.outer[1].center = [0.1, 0];
    expect(profileError(profile)).toMatch(/same positive distance/);
    const crossing = rectangularProfile(2, 1);
    crossing.outer[0].end = [2, 1];
    crossing.outer[1].start = [2, 1];
    crossing.outer[1].end = [0, 1];
    crossing.outer[2].start = [0, 1];
    crossing.outer[2].end = [2, 0];
    crossing.outer[3].start = [2, 0];
    expect(profileError(crossing)).toMatch(/intersect or overlap/);
  });
  it('rejects tangent, outside, overlapping holes and duplicate semantic IDs', () => {
    const profile = rectangularProfile(2, 1);
    profile.holes[0].radius = 0.5;
    expect(profileError(profile)).toMatch(/strictly inside/);
    profile.holes[0].radius = 0.1;
    profile.holes[0].center = [-1, 0.5];
    expect(profileError(profile)).toMatch(/strictly inside/);
    profile.holes[0].center = [1, 0.5];
    profile.holes.push({ id: 'another', name: 'Another hole', center: [1.1, 0.5], radius: 0.1 });
    expect(profileError(profile)).toMatch(/overlap or touch/);
    profile.holes[1].id = 'x0';
    expect(profileError(profile)).toMatch(/IDs must be unique/);
  });
  it('keeps semantic assignments through remeshing and requires explicit repair of deleted IDs', () => {
    const project = makeProject('kirsch-quarter');
    const before = project.study.loads[0].regions;
    project.study.mesh.size *= 0.5;
    project.study.mesh.boundarySize! *= 0.5;
    expect(regionNames('profile', '2d', project.geometry.profile).map((item) => item.id)).toEqual([
      'y0',
      'hole',
      'x0',
      'y1',
      'x1',
    ]);
    expect(project.study.loads[0].regions).toEqual(before);
    project.geometry.profile!.outer[4].id = 'left-new';
    expect(inputError(project)).toMatch(/deleted or renamed boundaries \(x1\)/);
    expect(project.study.loads[0].regions).toEqual(['x1', 'y1']);
    project.study.loads[0].regions = ['left-new', 'y1'];
    expect(inputError(project)).toBe(null);
  });
  it('retains condition values while requiring explicit reassignment after incompatible geometry changes', () => {
    const project = makeProject('kirsch-quarter');
    const name = project.study.constraints[0].name;
    changeGeometryKind(project, 'box');
    expect(project.study.constraints[0].name).toBe(name);
    expect(project.study.constraints[0].regions).toEqual([]);
    expect(project.study.loads[0].regions).toEqual([]);
    expect(inputError(project)).toMatch(/support needs/);
  });
  it('does not reuse a deleted boundary ID still referenced by a condition', () => {
    const project = makeProject('kirsch-quarter');
    project.geometry.profile!.holes = [
      { id: 'hole-1', name: 'Inner circle', center: [-2, 2], radius: 0.1 },
    ];
    project.study.loads[0].regions = ['hole-1'];
    project.geometry.profile!.holes = [];
    expect(freshBoundaryId(project, 'hole')).toBe('hole-2');
    expect(project.study.loads[0].regions).toEqual(['hole-1']);
    expect(inputError(project)).toMatch(/deleted or renamed/);
  });
  it('does not reattach a retired named boundary set when a new boundary is allocated', () => {
    const project = makeProject('kirsch-quarter');
    const profile = project.geometry.profile!;
    profile.holes = [{ id: 'hole-1', name: 'Original hole', center: [-2, 2], radius: 0.1 }];
    const selection = {
      id: 'retired-hole',
      name: 'Original hole boundary',
      geometryKind: 'profile' as const,
      dimension: '2d' as const,
      regions: ['hole-1'] as [string],
    };
    project.namedSelections = [selection];
    expect(selectionIsCompatible(project, selection)).toBe(true);
    profile.holes = [];
    expect(selectionIsCompatible(project, selection)).toBe(false);
    profile.holes.push({
      id: freshBoundaryId(project, 'hole'),
      name: 'Different hole',
      center: [-3, 2],
      radius: 0.1,
    });
    expect(profile.holes[0].id).toBe('hole-2');
    expect(selection.regions).toEqual(['hole-1']);
    expect(selectionIsCompatible(project, selection)).toBe(false);
  });
  it('rejects unsupported neural workflows and invalid typed traction before execution', () => {
    const project = makeProject('kirsch-quarter');
    expect(supportsPinn(project)).toBe(false);
    expect(() => changeStudySolver(project, 'pinn')).toThrow(/rectangular/);
    expect(project.study.solver.kind).toBe('fem');
    project.study.loads[0].traction = {
      kind: 'affine',
      xx: [1, 0, Infinity],
      yy: [0, 0, 0],
      xy: [0, 0, 0],
    };
    expect(inputError(project)).toMatch(/coefficients must be finite/);
    project.study.loads[0].traction = { kind: 'kirsch', radius: -1, center: [0, 0], tension: 1 };
    expect(inputError(project)).toMatch(/positive radius/);
    delete project.study.loads[0].traction;
    expect(validate(project)).toBe(false);
    expect(inputError(project)).toMatch(/typed traction definition/);
  });
  it('preserves edited definitions through JSON and makes retained fields stale on physical edit', () => {
    const project = makeProject('kirsch-quarter');
    const copy = JSON.parse(JSON.stringify(project));
    expect(validate(copy)).toBe(true);
    expect(copy).toEqual(project);
    const data = {
      manifest: { projectId: project.id, studyId: project.study.id, revision: project.revision },
    } as ResultData;
    expect(resultIsCurrent(project, data)).toBe(true);
    project.geometry.profile!.outer[1].name = 'Free circular boundary';
    project.study.mesh.boundarySize = 0.1;
    project.revision++;
    expect(resultIsCurrent(project, data)).toBe(false);
  });
});
