import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import {
  appendTrainingMetric,
  resultIsCurrent,
  runDuration,
  presentRun,
  type RunExecution,
} from './presentation';
import { changeStudyDimension, changeStudySolver, primaryOperation } from '../project/study';
import type { ResultData } from '../results/fields';
import type { Manifest, TrainingMetric } from '../contracts/types';

describe('study and solver product transitions', () => {
  it('clears incompatible assignments and selects the explicit 2D physical assumption', () => {
    const project = makeProject('cantilever');
    changeStudyDimension(project, '2d');
    expect(project.study.formulation).toBe('plane-stress');
    expect(project.geometry.kind).toBe('box');
    expect(project.study.constraints).toEqual([]);
    expect(project.study.loads).toEqual([]);
    changeStudySolver(project, 'pinn');
    expect(primaryOperation(project)).toBe('train');
    changeStudyDimension(project, '3d');
    expect(project.study.formulation).toBe('solid');
    expect(project.study.solver.kind).toBe('fem');
  });
  it('does not silently switch dimensions when an unsupported solver is selected', () => {
    const project = makeProject('cantilever');
    expect(() => changeStudySolver(project, 'pinn')).toThrow('2D plane-stress');
    expect(project.study.dimension).toBe('3d');
  });
  it('rejects old results after an input revision or study change', () => {
    const project = makeProject('plane-stress-tension');
    const data = {
      manifest: { projectId: project.id, studyId: project.study.id, revision: project.revision },
    } as ResultData;
    expect(resultIsCurrent(project, data)).toBe(true);
    project.revision++;
    expect(resultIsCurrent(project, data)).toBe(false);
    project.revision--;
    project.study.id = 'different-study';
    expect(resultIsCurrent(project, data)).toBe(false);
  });
});
describe('run provenance while retaining a previous result', () => {
  const project = makeProject('plane-stress-tension');
  const previousMetric: TrainingMetric = {
    jobId: 'previous-job',
    step: 1000,
    elapsed: 18,
    total: 0.01,
    pde: 0.004,
    boundary: 0.006,
    device: 'cuda',
  };
  const retained = {
    jobId: 'previous-job',
    operation: 'compare',
    durationSeconds: 20,
    training: {
      configuration: { ...project.study.solver.pinn, steps: 1000 },
      device: 'cuda',
      history: [previousMetric],
      timings: { trainingSeconds: 18, inferenceSeconds: 1 },
    },
  } as Manifest;
  function newExecution(): RunExecution {
    const snapshot = structuredClone(project);
    snapshot.study.solver.pinn.steps = 2000;
    return { project: snapshot, operation: 'compare' };
  }
  it('presents persisted history only when there is no newer execution', () => {
    const view = presentRun(project, retained, null, [], 'idle', 0);
    expect(view.manifest).toBe(retained);
    expect(view.jobId).toBe('previous-job');
    expect(view.history).toEqual([previousMetric]);
    expect(view.status).toBe('completed');
  });
  it('does not borrow the prior identity, history, device, configuration, or duration while preparing', () => {
    const view = presentRun(project, retained, newExecution(), [], 'preparing', 0.5);
    expect(view.manifest).toBeUndefined();
    expect(view.jobId).toBeUndefined();
    expect(view.device).toBeUndefined();
    expect(view.history).toEqual([]);
    expect(view.project.study.solver.pinn.steps).toBe(2000);
    expect(view.duration).toBe(0.5);
    expect(view.trainingStage).toBe('Preparing training');
    expect(view.retainedJobId).toBe('previous-job');
  });
  it('shows only the running job metrics and keeps its input snapshot after edits', () => {
    const execution = { ...newExecution(), jobId: 'new-job' };
    const currentMetric = {
      ...previousMetric,
      jobId: 'new-job',
      step: 20,
      elapsed: 1,
      device: 'cpu',
    };
    const edited = structuredClone(project);
    edited.study.solver.pinn.steps = 50;
    const view = presentRun(
      edited,
      retained,
      execution,
      [previousMetric, currentMetric],
      'running',
      1.5,
    );
    expect(view.jobId).toBe('new-job');
    expect(view.history).toEqual([currentMetric]);
    expect(view.project.study.solver.pinn.steps).toBe(2000);
    expect(view.device).toBe('cpu');
    expect(view.duration).toBe(1.5);
    expect(view.trainingStage).toBe('Training in progress');
  });
  it.each(['cancelled', 'failed'] as const)(
    'does not present old successful training as %s execution data',
    (status) => {
      const execution = { ...newExecution(), jobId: 'new-job' };
      const view = presentRun(project, retained, execution, [], status, 2);
      expect(view.manifest).toBeUndefined();
      expect(view.jobId).toBe('new-job');
      expect(view.history).toEqual([]);
      expect(view.device).toBeUndefined();
      expect(view.duration).toBe(2);
      expect(view.trainingStage).toBe(
        status === 'cancelled' ? 'Training cancelled' : 'Training failed',
      );
      expect(view.retainedJobId).toBe('previous-job');
    },
  );
});
describe('whole-job timing', () => {
  const comparison = {
    summary: { elapsedSeconds: 0.1 },
    comparison: { femSeconds: 0.1, trainingSeconds: 12, inferenceSeconds: 0.4 },
  } as Manifest;
  it('uses the native wall time when recorded', () => {
    expect(runDuration({ ...comparison, durationSeconds: 13.5 }, 100)).toBe(13.5);
  });
  it('includes learning and field evaluation rather than showing only the FEM time', () => {
    expect(runDuration(comparison, 100)).toBe(12.5);
  });
});
describe('training updates owned by the active run', () => {
  const sample: TrainingMetric = {
    jobId: 'current',
    step: 10,
    elapsed: 1,
    total: 0.02,
    pde: 0.01,
    boundary: 0.01,
    device: 'cpu',
  };
  it('ignores late updates from another job and nonfinite metrics', () => {
    expect(appendTrainingMetric([], sample, 'different')).toEqual([]);
    expect(appendTrainingMetric([], { ...sample, total: NaN }, 'current')).toEqual([]);
  });
  it('replaces repeated step updates while preserving a bounded real history', () => {
    const history = appendTrainingMetric([], sample, 'current');
    expect(appendTrainingMetric(history, { ...sample, total: 0.015 }, 'current')).toHaveLength(1);
    expect(appendTrainingMetric(history, { ...sample, step: 20 }, 'current')).toHaveLength(2);
  });
});
