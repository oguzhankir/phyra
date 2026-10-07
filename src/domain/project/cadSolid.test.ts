import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '../../../contracts/project.schema.json';
import { makeProject } from '../../features/examples/projects';
import type { CadSolidProject } from '../contracts/types';
import type { CadMeshReceipt } from '../geometry/cadMesh';
import {
  cadSolidDomainError,
  cadSolidDomainFromMesh,
  cadSolidSourceError,
  isCadSolidProject,
  type CadSolidSource,
} from './cadSolid';
import { documentError, isNumericalProject, reconcileStudyAfterGeometryEdit } from './document';
import { createHistory, recordEdit, undo } from './history';
import { namedSelectionError, selectedBoundaries, selectionIsCompatible } from './namedSelections';
import { prepareStudy, restraintRank } from './readiness';
import { projectRegions } from './regions';
import { recoveryEligible } from './recovery';
import { changeStudyDimension, changeStudySolver } from './study';

const validate = new Ajv({ strict: true }).compile(schema);

// Contract-only evidence: no display tessellation is presented as a numerical mesh.
function fixture() {
  const primitive = makeProject('cantilever');
  const source: CadSolidSource = {
    projectId: primitive.id,
    geometryFingerprint: 'a'.repeat(64),
    outputFeatureId: 'solid',
    faces: Array.from({ length: 6 }, (_, index) => ({
      id: `solid/face/${String(index).repeat(24)}`,
      name: `Exact face ${index + 1}`,
      identity: 'content-reference' as const,
    })),
    bodies: [{}],
    statistics: { bodyCount: 1, volume: 1 },
  };
  const receipt: CadMeshReceipt = {
    protocolVersion: 1,
    operation: 'mesh-cad',
    purpose: 'inspection-only',
    status: 'succeeded',
    projectId: primitive.id,
    revision: primitive.revision,
    jobId: 'inspection',
    geometryFingerprint: source.geometryFingerprint,
    outputFeatureId: source.outputFeatureId,
    coordinateFrame: 'cartesian-global-SI',
    targetSize: 0.4,
    meshId: 'b'.repeat(64),
    mesher: { name: 'Gmsh', version: 'fixture', element: 'tetra4' },
    correspondence: {
      status: 'verified',
      method: 'exact-brep-round-trip',
      scope: 'unchanged-geometry',
    },
    byteLength: 1,
    bufferHash: 'c'.repeat(64),
    arrays: {} as CadMeshReceipt['arrays'],
    regions: source.faces.map((face, index) => ({
      id: `mesh-face-${index + 1}`,
      name: `Mesh face ${index + 1}`,
      identity: 'mesh-scoped',
      triangleCount: 2,
      area: 1,
      cadFaceId: face.id,
    })),
    statistics: {
      bounds: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      nodes: 8,
      cells: 6,
      surfaceTriangles: 12,
      boundaryRegions: 6,
      minQuality: 0.5,
      maxQuality: 1,
      meanQuality: 0.75,
      exactVolume: 1,
      meshVolume: 1,
      relativeVolumeError: 0,
      exactSurfaceArea: 6,
      meshSurfaceArea: 6,
    },
  };
  const domain = cadSolidDomainFromMesh(receipt, source);
  const project: CadSolidProject = {
    ...primitive,
    geometry: {
      kind: 'cad',
      dimension: '3d',
      outputFeatureId: 'solid',
      assets: [],
      features: [{ id: 'solid', name: 'Solid', kind: 'box', length: 1, width: 1, height: 1 }],
    },
    study: { ...primitive.study, domain },
  };
  project.study.constraints[0].regions = [domain.boundaries[0].id];
  project.study.loads[0].regions = [domain.boundaries[1].id];
  return { project, source, receipt };
}

describe('source-bound exact CAD studies', () => {
  it('keeps the authored CAD source and creates schema-valid stable aliases independently of remesh order', () => {
    const { project, source, receipt } = fixture();
    expect(validate(project), JSON.stringify(validate.errors)).toBe(true);
    expect(isCadSolidProject(project)).toBe(true);
    expect(isNumericalProject(project)).toBe(false);
    expect(documentError(project)).toBeNull();
    expect(project.geometry).not.toHaveProperty('length');
    expect(projectRegions(project)).toEqual(
      project.study.domain.boundaries.map(({ id, name }) => ({ id, name })),
    );
    const remeshed = structuredClone(receipt);
    remeshed.meshId = 'd'.repeat(64);
    remeshed.regions.reverse().forEach((region, index) => {
      region.id = `mesh-face-${index + 1}`;
    });
    const reordered = cadSolidDomainFromMesh(remeshed, source);
    expect(new Map(reordered.boundaries.map((face) => [face.id, face.faceId]))).toEqual(
      new Map(project.study.domain.boundaries.map((face) => [face.id, face.faceId])),
    );
  });

  it('requires fresh accepted exact evidence after reopen without hiding authored physical definitions', () => {
    const { project, source } = fixture();
    expect(prepareStudy(project).canMesh).toBe(false);
    expect(prepareStudy(project).canRun).toBe(false);
    expect(prepareStudy(project).firstMissing).toBe('geometry');
    const ready = prepareStudy(project, 0, source);
    expect(ready.canMesh).toBe(true);
    expect(ready.canRun).toBe(true);
    expect(restraintRank(project)).toBeNull();
    expect(ready.checks.find((check) => check.section === 'constraints')).toMatchObject({
      state: 'review',
      detail: expect.stringContaining('generated mesh'),
    });
    expect(prepareStudy(project, 1, source).canMesh).toBe(false);
  });

  it('allows recovery of stale assignments while requiring explicit repair before execution', () => {
    const { project, source } = fixture();
    const originalAssignments = structuredClone(project.study.constraints);
    const changed = { ...source, geometryFingerprint: 'e'.repeat(64) };
    expect(documentError(project)).toBeNull();
    expect(recoveryEligible(project, true, 0)).toBe(true);
    expect(cadSolidSourceError(project, changed)).toContain('repair');
    expect(prepareStudy(project, 0, changed).canRun).toBe(false);
    expect(project.study.constraints).toEqual(originalAssignments);
    project.geometry.outputFeatureId = 'another-output';
    expect(cadSolidSourceError(project, source)).toContain('repair');
  });

  it('retains source-bound assignments through geometry edits and restores them when recreation is undone', () => {
    const { project, source } = fixture();
    const edited = structuredClone(project);
    const feature = edited.geometry.features[0];
    if (feature.kind !== 'box') throw new Error('Expected box fixture.');
    feature.length = 2;
    reconcileStudyAfterGeometryEdit(project, edited);
    expect(edited.study).toEqual(project.study);
    const changed = recordEdit(createHistory(project), project, edited, true);
    const currentSource = { ...source, geometryFingerprint: 'e'.repeat(64) };
    expect(prepareStudy(changed.project, 0, currentSource).canRun).toBe(false);
    expect(recoveryEligible(changed.project, true, 0)).toBe(true);
    const recreated = structuredClone(changed.project);
    recreated.study.id = 'replacement-study';
    recreated.study.domain.geometryFingerprint = currentSource.geometryFingerprint;
    recreated.study.constraints = [];
    recreated.study.loads = [];
    const replacement = recordEdit(changed.history, changed.project, recreated, true);
    const restored = undo(replacement.history, replacement.project);
    expect(restored.project.geometry).toEqual(changed.project.geometry);
    expect(restored.project.study.domain).toEqual(project.study.domain);
    expect(restored.project.study.constraints).toEqual(project.study.constraints);
    expect(restored.project.study.loads).toEqual(project.study.loads);
    expect(restored.project.study.id).toBe(project.study.id);
    expect(prepareStudy(restored.project, 0, currentSource).canRun).toBe(false);
    expect(restored.project.revision).toBe(replacement.project.revision + 1);
  });

  it('preserves legacy adapter invalidation and discards studies after empty or dimension changes', () => {
    const { project } = fixture();
    const legacy = structuredClone(project) as import('../contracts/types').ProjectDefinition;
    delete legacy.study!.domain;
    const next = structuredClone(legacy);
    if (next.geometry.kind !== 'cad') throw new Error('Expected CAD fixture.');
    next.geometry.features[0].name = 'Changed source';
    reconcileStudyAfterGeometryEdit(legacy, next);
    expect(next.study?.constraints).toEqual([]);
    expect(next.study?.loads).toEqual([]);
    const planar = structuredClone(project) as import('../contracts/types').ProjectDefinition;
    if (planar.geometry.kind !== 'cad') throw new Error('Expected CAD fixture.');
    planar.geometry.dimension = '2d';
    reconcileStudyAfterGeometryEdit(project, planar);
    expect(planar.study).toBeNull();
    const empty = { ...project, geometry: { kind: 'empty' as const, dimension: '3d' as const } };
    reconcileStudyAfterGeometryEdit(project, empty);
    expect(empty.study).toBeNull();
  });

  it('rejects foreign, partial, ambiguous, component and non-volume evidence', () => {
    const { project, source } = fixture();
    const changes: ((value: CadSolidSource) => void)[] = [
      (value) => {
        value.projectId = 'another-project';
      },
      (value) => {
        value.outputFeatureId = 'another-output';
      },
      (value) => {
        value.faces.pop();
      },
      (value) => {
        value.faces[0].id = value.faces[1].id;
      },
      (value) => {
        value.faces[0].identity = 'ambiguous';
      },
      (value) => {
        value.faces[0].componentId = 'instance';
      },
      (value) => {
        value.bodies[0].componentPath = [];
      },
      (value) => {
        value.statistics.bodyCount = 2;
      },
      (value) => {
        value.statistics.volume = 0;
      },
      (value) => {
        value.statistics.volume = NaN;
      },
    ];
    for (const change of changes) {
      const altered = structuredClone(source);
      change(altered);
      expect(cadSolidSourceError(project, altered)).not.toBeNull();
      expect(prepareStudy(project, 0, altered).canRun).toBe(false);
    }
  });

  it('refuses incomplete or duplicate inspection correspondence as admission evidence', () => {
    const { source, receipt } = fixture();
    receipt.correspondence = {
      status: 'unavailable',
      method: 'exact-brep-round-trip',
      scope: 'unchanged-geometry',
      reason: 'No exact correspondence.',
    };
    receipt.regions.forEach((region) => {
      delete region.cadFaceId;
    });
    expect(() => cadSolidDomainFromMesh(receipt, source)).toThrow();
    const duplicate = fixture().receipt;
    duplicate.projectId = source.projectId;
    duplicate.regions[1].cadFaceId = duplicate.regions[0].cadFaceId;
    expect(() => cadSolidDomainFromMesh(duplicate, source)).toThrow();
  });

  it('rejects catalog collisions and shared-policy blank names without repairing them silently', () => {
    const { project } = fixture();
    project.study.domain.boundaries[1].id = project.study.domain.boundaries[0].id;
    expect(cadSolidDomainError(project)).toContain('unique');
    const blank = fixture().project;
    blank.study.domain.boundaries[0].name = '\ufeff\u001c';
    expect(cadSolidDomainError(blank)).not.toBeNull();
    blank.study.domain.boundaries[0].name = 'Face';
    blank.study.domain.boundaries[0].faceId = `${'界'.repeat(60)}/face/${'a'.repeat(24)}`;
    expect(cadSolidDomainError(blank)).not.toBeNull();
    const fingerprint = fixture().project;
    fingerprint.study.domain.geometryFingerprint += '\n';
    expect(cadSolidDomainError(fingerprint)).not.toBeNull();
    expect(validate(fingerprint)).toBe(false);
  });

  it('validates face ownership within the saved catalog without requiring its old source to remain selected', () => {
    const { project } = fixture();
    project.study.domain.outputFeatureId = 'previous-output';
    expect(cadSolidDomainError(project)).not.toBeNull();
    for (const boundary of project.study.domain.boundaries)
      boundary.faceId = boundary.faceId.replace('solid/face/', 'previous-output/face/');
    expect(cadSolidDomainError(project)).toBeNull();
    project.study.domain.boundaries[0].faceId = `previous-output/face/nested/face/${'a'.repeat(24)}`;
    expect(cadSolidDomainError(project)).not.toBeNull();
    const long = fixture().project;
    long.study.domain.outputFeatureId = '界'.repeat(34);
    for (const boundary of long.study.domain.boundaries)
      boundary.faceId = boundary.faceId.replace(
        'solid/face/',
        'feature-cdd475159b5f992bbaee364b/face/',
      );
    expect(cadSolidDomainError(long)).toBeNull();
  });

  it('checks same-face support conflicts but delegates intersecting-face nodes to the worker', () => {
    const { project, source } = fixture();
    project.study.constraints.push({
      ...structuredClone(project.study.constraints[0]),
      id: 'second',
      components: [0.1, null, null],
    });
    expect(
      prepareStudy(project, 0, source).checks.find((item) => item.section === 'constraints')?.state,
    ).toBe('invalid');
    project.study.constraints[1].regions = [project.study.domain.boundaries[2].id];
    expect(
      prepareStudy(project, 0, source).checks.find((item) => item.section === 'constraints')?.state,
    ).toBe('review');
    project.study.constraints = [];
    expect(prepareStudy(project, 0, source).canRun).toBe(false);
  });

  it('stamps copied boundary sets to exact source content and retains incompatible sets for repair', () => {
    const { project } = fixture();
    project.namedSelections = [
      {
        id: 'set',
        name: 'Fixture',
        geometryKind: 'cad',
        dimension: '3d',
        geometryFingerprint: project.study.domain.geometryFingerprint,
        regions: [project.study.domain.boundaries[0].id],
      },
    ];
    const set = project.namedSelections[0];
    expect(validate(project), JSON.stringify(validate.errors)).toBe(true);
    expect(selectionIsCompatible(project, set)).toBe(true);
    expect(selectedBoundaries(project, [set.regions[0], 'x0', set.regions[0]])).toEqual(
      set.regions,
    );
    project.study.domain.geometryFingerprint = 'd'.repeat(64);
    expect(selectionIsCompatible(project, set)).toBe(false);
    expect(namedSelectionError(project)).toBeNull();
    set.geometryFingerprint += '\n';
    expect(namedSelectionError(project)).not.toBeNull();
    expect(validate(project)).toBe(false);
    delete set.geometryFingerprint;
    expect(namedSelectionError(project)).not.toBeNull();
    expect(validate(project)).toBe(false);
  });

  it('keeps unsupported dimensional and Physics ML conversion explicit', () => {
    const { project } = fixture();
    expect(() => changeStudyDimension(project, '2d')).toThrow('CAD');
    expect(() => changeStudySolver(project, 'pinn')).toThrow();
    expect(project.study.dimension).toBe('3d');
    expect(project.study.solver.kind).toBe('fem');
  });

  it('rejects unsupported boundary refinement before numerical submission', () => {
    const { project, source } = fixture();
    project.study.mesh.boundarySize = 0.001;
    const readiness = prepareStudy(project, 0, source);
    expect(readiness.canMesh).toBe(false);
    expect(readiness.canRun).toBe(false);
    expect(readiness.checks.find((check) => check.section === 'mesh')).toMatchObject({
      state: 'invalid',
      detail: expect.stringContaining('one global target size'),
    });
  });
});
