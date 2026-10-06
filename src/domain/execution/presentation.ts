import type {
  Manifest,
  Operation,
  Project,
  ProjectDefinition,
  TrainingMetric,
} from '../contracts/types';
import type { ResultData } from '../results/fields';

export type RunStatus = 'idle' | 'preparing' | 'running' | 'completed' | 'cancelled' | 'failed';
export type RunExecution = {
  project: Project;
  definition?: ProjectDefinition;
  operation: Operation;
  jobId?: string;
  manifest?: Manifest;
};

export function presentRun(
  project: Project,
  retainedManifest: Manifest | undefined,
  execution: RunExecution | null,
  metrics: TrainingMetric[],
  status: RunStatus,
  elapsed: number,
) {
  const manifest = execution?.manifest ?? (execution ? undefined : retainedManifest);
  const history = execution
    ? metrics.filter((sample) => sample.jobId === execution.jobId)
    : (manifest?.training?.history ?? []);
  const visibleStatus = status === 'idle' && manifest ? 'completed' : status;
  const operation = execution?.operation ?? manifest?.operation ?? null;
  const trainingRun = operation === 'train' || operation === 'compare';
  const trainingStage = !trainingRun
    ? 'No PINN training in this run'
    : visibleStatus === 'preparing'
      ? 'Preparing training'
      : visibleStatus === 'running'
        ? 'Training in progress'
        : visibleStatus === 'cancelled'
          ? 'Training cancelled'
          : visibleStatus === 'failed'
            ? 'Training failed'
            : manifest?.training
              ? 'Training completed'
              : 'Configured training budget';
  return {
    project: execution?.project ?? project,
    manifest,
    history,
    status: visibleStatus,
    operation,
    jobId: execution?.jobId ?? manifest?.jobId,
    duration: runDuration(manifest, elapsed),
    trainingStage,
    device:
      history.at(-1)?.device ??
      manifest?.training?.device ??
      manifest?.device ??
      (operation === 'mesh' || operation === 'solve' ? 'CPU' : undefined),
    retainedJobId:
      execution && retainedManifest && retainedManifest.jobId !== execution.jobId
        ? retainedManifest.jobId
        : undefined,
  };
}

export function runDuration(manifest: Manifest | undefined, elapsed: number): number {
  if (manifest?.durationSeconds !== undefined) return manifest.durationSeconds;
  if (manifest?.comparison)
    return (
      manifest.comparison.femSeconds +
      manifest.comparison.trainingSeconds +
      manifest.comparison.inferenceSeconds
    );
  if (manifest?.training)
    return manifest.training.timings.trainingSeconds + manifest.training.timings.inferenceSeconds;
  return manifest?.summary?.elapsedSeconds ?? elapsed;
}
export function resultIsCurrent(project: ProjectDefinition, data: ResultData | null): boolean {
  return (
    !!data &&
    data.manifest.projectId === project.id &&
    data.manifest.studyId === project.study?.id &&
    data.manifest.revision === project.revision
  );
}
export function appendTrainingMetric(
  history: TrainingMetric[],
  sample: TrainingMetric,
  expectedJobId?: string,
): TrainingMetric[] {
  if (
    (expectedJobId && sample.jobId !== expectedJobId) ||
    ![sample.step, sample.elapsed, sample.total, sample.pde, sample.boundary].every(
      Number.isFinite,
    ) ||
    !Number.isSafeInteger(sample.step) ||
    sample.step < 0 ||
    sample.elapsed < 0 ||
    sample.total < 0 ||
    sample.pde < 0 ||
    sample.boundary < 0
  )
    return history;
  const existing = history.findIndex((item) => item.step === sample.step);
  if (existing >= 0) return history.map((item, index) => (index === existing ? sample : item));
  return [...history, sample].slice(-2000);
}
