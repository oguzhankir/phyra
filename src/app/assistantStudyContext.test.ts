import { describe, expect, it } from 'vitest';
import savedProject from '../../public/reference/three-dimensional.project.json';
import savedManifest from '../../public/reference/three-dimensional.manifest.json';
import type { CadFeature, Manifest, Project, ProjectDefinition } from '../domain/contracts/types';
import type { ResultData } from '../domain/results/fields';
import { prepareStudy } from '../domain/project/readiness';
import { assistantContext } from '../features/assistant/context';
import { assistantStudyContext } from './assistantStudyContext';
import type { ProjectDocumentSnapshot } from './projectDocuments';
import type { CadReceipt } from '../platform/desktop/cad';
import { documentPreparation } from '../domain/project/document';
import { textBytes } from '../domain/assistant/prompt';

const project = savedProject as Project;
const manifest = savedManifest as unknown as Manifest;
function active(changes: Partial<ProjectDocumentSnapshot> = {}) {
  return {
    documentId: 'reference-document',
    project,
    section: 'results',
    preparation: prepareStudy(project),
    currentData: { manifest, buffer: new ArrayBuffer(0) } as ResultData,
    runExecution: null,
    runStatus: 'completed',
    progress: null,
    error: null,
    ...changes,
  } as ProjectDocumentSnapshot;
}
describe('exact assistant study and retained result provenance', () => {
  it('attaches the actual reference summary and identities without buffers or archive paths', () => {
    const study = assistantStudyContext(active())!;
    const context = assistantContext('Explain this result', study, true);
    expect(context).toMatchObject({
      kind: 'study',
      projectId: project.id,
      studyId: project.study.id,
      revision: project.revision,
    });
    expect(context.text).toContain(manifest.jobId);
    expect(context.text).toContain(manifest.fingerprint);
    expect(context.text).toContain(String(manifest.summary!.maxDisplacement));
    expect(context.text).not.toContain('"arrays"');
    expect(context.text).not.toContain('"buffer"');
    expect(context.text).toContain('"state": "current-for-inputs"');
  });
  it('documentation-only context excludes even the active project identity', () => {
    const privateProject = { ...project, id: 'private-identity', name: 'Private geometry name' };
    const context = assistantContext(
      'How do I start?',
      assistantStudyContext(active({ project: privateProject })),
      false,
    );
    expect(context.kind).toBe('help');
    expect(context.projectId).toBeNull();
    expect(context.text).not.toContain(privateProject.id);
    expect(context.text).not.toContain(privateProject.name);
    expect(context.text).not.toContain(manifest.jobId);
  });
  it('retains old fields separately, without inventing an ID for a preparing attempt', () => {
    const next = { ...project, revision: project.revision + 1 };
    const study = assistantStudyContext(
      active({
        project: next,
        runStatus: 'preparing',
        runExecution: { project: next, operation: 'solve' },
      }),
    )!;
    expect(study.run).toBeNull();
    expect(study.manifest).toBe(manifest);
    const text = assistantContext('What is running?', study, true).text;
    expect(text).toContain('"latestJob": false');
    expect(text).toContain('"state": "stale"');
  });
  it('never attributes preceding numerical values or fingerprint to a new running job', () => {
    const next = { ...project, revision: project.revision + 1 };
    const study = assistantStudyContext(
      active({
        project: next,
        runStatus: 'running',
        runExecution: { project: next, operation: 'solve', jobId: 'new-test-job' },
      }),
    )!;
    expect(study.run).toMatchObject({
      jobId: 'new-test-job',
      state: 'running',
      inputFingerprint: null,
    });
    expect(JSON.parse(study.run!.summary).summary).toBeNull();
    expect(study.run!.summary).not.toContain(manifest.fingerprint);
    expect(study.run!.summary).not.toContain(String(manifest.summary!.maxDisplacement));
  });
  it('labels retained failed and cancelled attempts with their own identity', () => {
    for (const state of ['failed', 'cancelled'] as const) {
      const study = assistantStudyContext(
        active({
          runStatus: state,
          runExecution: { project, operation: 'solve', jobId: `test-${state}` },
        }),
      )!;
      expect(study.run!.state).toBe(state);
      expect(study.run!.inputFingerprint).toBeNull();
      expect(study.manifest!.jobId).toBe(manifest.jobId);
    }
  });
});

const circleSketch: Extract<CadFeature, { kind: 'sketch' }> = {
  id: 'sketch1',
  name: 'Circular profile',
  kind: 'sketch',
  plane: 'xy',
  sketch: {
    points: [{ id: 'center', position: [0.02, 0.02] }],
    entities: [
      { id: 'circle', name: 'Outer circle', kind: 'circle', centerId: 'center', radius: 0.02 },
    ],
    constraints: [{ id: 'diameter1', kind: 'diameter', curveId: 'circle', value: 0.04 }],
    loops: [{ id: 'outer', role: 'outer', entityIds: ['circle'] }],
  },
};
function cadProject(): ProjectDefinition {
  return {
    schemaVersion: 7,
    id: 'private-cad-project',
    name: 'Editable CAD',
    revision: 2,
    displayUnits: 'mm',
    geometry: {
      kind: 'cad',
      dimension: '3d',
      features: [
        circleSketch,
        { id: 'solid', name: 'Extrusion', kind: 'extrude', sketchId: 'sketch1', distance: 0.01 },
      ],
      outputFeatureId: 'solid',
      assets: [],
    },
    study: null,
    namedSelections: [],
  };
}
/** Constructed transport fixture, not a recorded kernel or mechanics result. */
function cadReceipt(): CadReceipt {
  return {
    protocolVersion: 1,
    operation: 'cad',
    status: 'succeeded',
    projectId: 'private-cad-project',
    revision: 2,
    jobId: 'cad-fixture-job',
    geometryFingerprint: 'a'.repeat(64),
    outputFeatureId: 'solid',
    coordinateFrame: 'cartesian-global-SI',
    kernel: {
      name: 'OpenCASCADE',
      version: '8.0.1',
      binding: 'cadquery-ocp-novtk',
      bindingVersion: '8.0.1.1.0',
    },
    byteLength: 123,
    bufferHash: 'b'.repeat(64),
    arrays: {} as CadReceipt['arrays'],
    faces: [],
    edges: [],
    bodies: [],
    features: [
      {
        id: 'sketch1',
        kind: 'sketch',
        sketch: {
          status: 'solved',
          degreesOfFreedom: 2,
          failedConstraintIds: [],
          points: [{ position: [123, 456] }],
        },
      },
      { id: 'solid', kind: 'extrude' },
    ],
    diagnostics: [
      {
        code: 'cad-independence',
        severity: 'info',
        message: 'CAD and numerical eligibility are separate.',
      },
    ],
    statistics: {
      bounds: [
        [0, 0, 0],
        [0.04, 0.04, 0.01],
      ],
      surfaceArea: 0.005,
      volume: 0.00001,
      faceCount: 3,
      edgeCount: 3,
      bodyCount: 1,
      nodes: 50,
      triangles: 100,
      displayDeflection: 0.0001,
    },
    analysisCompatibility: {
      state: 'unsupported',
      dimension: '3d',
      methodIds: [],
      reason: 'The current 3D extrusion adapter requires a rectangular profile.',
    },
  };
}
function cadActive(
  receipt: CadReceipt | null = null,
  changes: Partial<ProjectDocumentSnapshot> = {},
) {
  const definition = cadProject();
  return active({
    project: definition,
    section: 'geometry',
    preparation: documentPreparation(definition),
    currentData: null,
    runExecution: null,
    runStatus: 'idle',
    cad: { busy: false, receipt },
    ...changes,
  });
}

describe('bounded CAD assistant preparation evidence', () => {
  it('supports an empty project with no study, numerical result or invented geometry assessment', () => {
    const definition = {
      ...cadProject(),
      geometry: { kind: 'empty' as const, dimension: '3d' as const },
    };
    const study = assistantStudyContext(
      cadActive(null, { project: definition, currentData: { manifest } as ResultData }),
    )!;
    expect(study.run).toBeNull();
    expect(study.manifest).toBeNull();
    expect(study.cad).toMatchObject({
      state: 'unevaluated',
      featureCount: 0,
      outputFeatureId: null,
      evaluation: null,
    });
    const context = assistantContext('How do I create my first sketch?', study, true);
    expect(context).toMatchObject({
      kind: 'project',
      projectId: definition.id,
      revision: 2,
      studyId: null,
    });
    expect(context.text).toContain('"study": null');
    expect(context.text).not.toContain(manifest.jobId);
    expect(context.text).not.toContain('cad-fixture-job');
  });
  it('preserves authored constraints and separates current CAD evidence from unsupported analysis', () => {
    const study = assistantStudyContext(cadActive(cadReceipt()))!;
    const context = assistantContext(
      'Why can this CAD output not proceed to analysis?',
      study,
      true,
    );
    expect(study.cad).toMatchObject({
      state: 'current',
      outputFeatureId: 'solid',
      featureCount: 2,
      sketchCount: 1,
    });
    const summary = JSON.parse(study.cad!.evaluation!.summary);
    expect(summary.analysisCompatibility).toMatchObject({ state: 'unsupported', methodIds: [] });
    expect(summary.sketches).toEqual([
      {
        featureId: 'sketch1',
        status: 'solved',
        degreesOfFreedom: 2,
        failedConstraintIds: [],
        failedConstraintCount: 0,
      },
    ]);
    expect(context.text).toContain('"diameter1"');
    expect(context.text).toContain('cad-fixture-job');
    expect(context.text).toContain('a'.repeat(64));
    expect(context.text).not.toContain('"arrays"');
    expect(context.text).not.toContain('"triangles"');
    expect(context.text).not.toContain('123,456');
    expect(study.run).toBeNull();
  });
  it('keeps the evaluated revision when only analysis metadata advances and drops changed-output evidence', () => {
    const definition = { ...cadProject(), revision: 3 };
    const study = assistantStudyContext(cadActive(cadReceipt(), { project: definition }))!;
    expect(study.cad!.evaluation!.revision).toBe(2);
    for (const receipt of [
      null,
      { ...cadReceipt(), projectId: 'another-project' },
      { ...cadReceipt(), outputFeatureId: 'previous-output' },
      { ...cadReceipt(), revision: 4 },
    ]) {
      const changed = assistantStudyContext(cadActive(receipt, { project: definition }))!;
      expect(changed.cad!.state).toBe('unevaluated');
      expect(changed.cad!.evaluation).toBeNull();
    }
  });
  it('does not attach CAD identity, authored names or evaluation data in help-only mode', () => {
    const context = assistantContext(
      'How do constraints work?',
      assistantStudyContext(cadActive(cadReceipt())),
      false,
    );
    expect(context.kind).toBe('help');
    expect(context.text).not.toContain('private-cad-project');
    expect(context.text).not.toContain('Editable CAD');
    expect(context.text).not.toContain('cad-fixture-job');
    expect(context.text).not.toContain('a'.repeat(64));
  });
  it('exposes an owned open-sketch solve separately without inventing exact-shape eligibility', () => {
    const study = assistantStudyContext(
      cadActive(null, {
        cad: {
          busy: false,
          receipt: null,
          sketchSolve: {
            featureId: 'sketch1',
            report: {
              status: 'conflicting',
              degreesOfFreedom: null,
              failedConstraintIds: ['diameter1'],
              kernel: 'SolveSpace 3.2',
              sourceCommit: '27b6a080c8b669421bd4d444650c3b8eddec5687',
            },
          },
        },
      }),
    )!;
    expect(study.cad).toMatchObject({
      state: 'unevaluated',
      evaluation: null,
      sketchSolve: {
        featureId: 'sketch1',
        status: 'conflicting',
        degreesOfFreedom: null,
        failedConstraintIds: ['diameter1'],
        failedConstraintCount: 1,
      },
    });
    const context = assistantContext('Explain the conflicting sketch constraint', study, true);
    expect(context.text).toContain('diameter1');
    expect(context.text).not.toContain('cad-fixture-job');
    expect(context.text).not.toContain('rectangular profile');
    const help = assistantContext('Explain the conflicting sketch constraint', study, false);
    expect(help.text).not.toContain('diameter1');
  });
  it('uses a clearly marked bounded graph summary when the full authored definition cannot fit', () => {
    const definition = cadProject();
    if (definition.geometry.kind !== 'cad') throw new Error('Fixture must be CAD');
    const largeFeatures = Array.from({ length: 12 }, (_, index) => ({
      ...structuredClone(circleSketch),
      id: `largeSketch${index}`,
      sketch: {
        ...structuredClone(circleSketch.sketch),
        points: Array.from({ length: 256 }, (_, point) => ({
          id: point === 0 ? 'center' : `p${point}`,
          position: [point / 1000, index / 1000] as [number, number],
        })),
      },
    }));
    definition.geometry.features = [largeFeatures[0], ...largeFeatures.slice(1)];
    definition.geometry.outputFeatureId = 'largeSketch11';
    const context = assistantContext(
      'Explain my CAD definition',
      assistantStudyContext(cadActive(null, { project: definition })),
      true,
    );
    expect(context.text).toContain('"definitionScope": "summary-only"');
    expect(context.text).toContain('"pointCount": 256');
    expect(context.text).toContain('"constraintKinds"');
    expect(context.text).not.toContain('"p255"');
    expect(textBytes(context.text)).toBeLessThan(120 * 1024);
  });
  it('bounds retained reports without substituting object payloads or publishing nonfinite DOF', () => {
    const receipt = cadReceipt();
    receipt.features = Array.from({ length: 25 }, (_, index) => ({
      id: `feature${index}`,
      kind: 'sketch',
      sketch: {
        status: index === 0 ? { secret: 'bulk-payload' } : 'solved',
        degreesOfFreedom: NaN,
        failedConstraintIds: Array.from({ length: 20 }, (_, i) => `constraint${i}`),
      },
    }));
    receipt.diagnostics = Array.from({ length: 20 }, () => ({
      code: 'bounded',
      severity: 'warning',
      message: 'x'.repeat(2000),
    }));
    const summary = JSON.parse(assistantStudyContext(cadActive(receipt))!.cad!.evaluation!.summary);
    expect(summary.sketches).toHaveLength(16);
    expect(summary.sketches[0]).toMatchObject({
      status: 'unavailable',
      degreesOfFreedom: null,
      failedConstraintCount: 20,
    });
    expect(summary.sketches[0].failedConstraintIds).toHaveLength(8);
    expect(summary.omittedSketchReportCount).toBe(9);
    expect(summary.diagnostics).toHaveLength(8);
    expect(summary.diagnostics[0].message).toHaveLength(500);
    expect(summary.diagnostics[0].messageTruncated).toBe(true);
    expect(summary.omittedDiagnosticCount).toBe(12);
    expect(JSON.stringify(summary)).not.toContain('bulk-payload');
  });
});
