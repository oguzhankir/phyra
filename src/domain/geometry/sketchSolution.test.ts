import { describe, expect, it } from 'vitest';
import { blankProject } from '../project/document';
import { validateSketchSolution, type SketchSolution } from './sketchSolution';

function fixture() {
  const project = blankProject();
  const sketch = {
    points: [
      { id: 'a', position: [0, 0] as [number, number] },
      { id: 'b', position: [0.1, 0.02] as [number, number] },
    ],
    entities: [{ id: 'line', name: 'Line', kind: 'line' as const, startId: 'a', endId: 'b' }],
    constraints: [{ id: 'h', kind: 'horizontal' as const, lineId: 'line' }],
    loops: [],
  };
  project.geometry = {
    kind: 'cad',
    dimension: '3d',
    features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'xy', sketch }],
    assets: [],
    outputFeatureId: 'sketch',
  };
  const receipt: SketchSolution = {
    protocolVersion: 1,
    operation: 'solve-sketch',
    status: 'succeeded',
    projectId: project.id,
    revision: project.revision,
    jobId: 'job',
    featureId: 'sketch',
    geometryFingerprint: 'a'.repeat(64),
    sketch: structuredClone(sketch),
    report: {
      kernel: 'SolveSpace 3.2',
      sourceCommit: 'b'.repeat(40),
      status: 'solved',
      degreesOfFreedom: 3,
      failedConstraintIds: [],
    },
  };
  return { project, receipt };
}
describe('owned sketch solver publication', () => {
  it('accepts real open-sketch coordinate changes independently of closed-face readiness and JSON key order', () => {
    const { project, receipt } = fixture();
    receipt.sketch.points[1].position = [0.1, 0];
    receipt.sketch.constraints = [{ lineId: 'line', kind: 'horizontal', id: 'h' }];
    expect(validateSketchSolution(receipt, project, 'sketch')).toBe(receipt);
    expect(
      project.geometry.kind === 'cad' &&
        project.geometry.features[0].kind === 'sketch' &&
        project.geometry.features[0].sketch.points[1].position,
    ).toEqual([0.1, 0.02]);
  });
  it.each([
    'project',
    'revision',
    'target',
    'point',
    'entity',
    'constraint',
    'finite',
    'dof',
    'failed-id',
    'provenance',
    'solved-null',
    'conflict-dof',
  ] as const)('rejects untrusted %s without changing the authored graph', (defect) => {
    const { project, receipt } = fixture();
    if (defect === 'project') receipt.projectId = 'another';
    if (defect === 'revision') receipt.revision++;
    if (defect === 'target') receipt.featureId = 'another';
    if (defect === 'point') receipt.sketch.points[0].id = 'changed';
    if (defect === 'entity' && receipt.sketch.entities[0].kind === 'line')
      receipt.sketch.entities[0].endId = 'a';
    if (defect === 'constraint') receipt.sketch.constraints = [];
    if (defect === 'finite') receipt.sketch.points[0].position[0] = Infinity;
    if (defect === 'dof') receipt.report.degreesOfFreedom = 100;
    if (defect === 'failed-id') receipt.report.failedConstraintIds = ['unknown'];
    if (defect === 'solved-null') receipt.report.degreesOfFreedom = null;
    if (defect === 'conflict-dof') receipt.report.status = 'conflicting';
    if (defect === 'provenance') receipt.report.sourceCommit = 'invented';
    expect(() => validateSketchSolution(receipt, project, 'sketch')).toThrow();
  });
  it('retains failed authored coordinates and names the actual conflicting constraint', () => {
    const { project, receipt } = fixture();
    receipt.report = {
      ...receipt.report,
      status: 'conflicting',
      degreesOfFreedom: null,
      failedConstraintIds: ['h'],
    };
    expect(validateSketchSolution(receipt, project, 'sketch').report.status).toBe('conflicting');
    receipt.sketch.points[1].position = [0.1, 0];
    expect(() => validateSketchSolution(receipt, project, 'sketch')).toThrow('Failed sketch solve');
  });
});
