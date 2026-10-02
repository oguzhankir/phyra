import type { AssistantRunSnapshot } from '../domain/assistant/types';
import type { AssistantStudyContext } from '../features/assistant/context';
import type { ProjectDocumentSnapshot } from './projectDocuments';

export function assistantStudyContext(
  active: Pick<
    ProjectDocumentSnapshot,
    | 'documentId'
    | 'project'
    | 'section'
    | 'preparation'
    | 'currentData'
    | 'runExecution'
    | 'runStatus'
    | 'progress'
    | 'error'
    | 'inspection'
  > | null,
): AssistantStudyContext | null {
  if (!active) return null;
  const manifest = active.currentData?.manifest ?? active.runExecution?.manifest ?? null;
  const jobId = active.runExecution ? active.runExecution.jobId : manifest?.jobId;
  const runManifest = active.runExecution
    ? active.runExecution.manifest?.jobId === jobId
      ? active.runExecution.manifest
      : null
    : manifest;
  const matches =
    !!runManifest &&
    runManifest.projectId === active.project.id &&
    runManifest.studyId === active.project.study.id &&
    runManifest.revision === active.project.revision;
  const state: AssistantRunSnapshot['state'] =
    active.runStatus === 'running' || active.runStatus === 'preparing'
      ? 'running'
      : active.runStatus === 'cancelled'
        ? 'cancelled'
        : active.runStatus === 'failed'
          ? 'failed'
          : matches
            ? 'current'
            : 'stale';
  const run: AssistantRunSnapshot | null = jobId
    ? {
        jobId,
        studyId:
          active.runExecution?.project.study.id ?? runManifest?.studyId ?? active.project.study.id,
        inputFingerprint: runManifest?.fingerprint ?? null,
        state,
        summary: JSON.stringify({
          operation: active.runExecution?.operation ?? runManifest?.operation,
          status: active.runStatus,
          revision: active.runExecution?.project.revision ?? runManifest?.revision,
          progress: active.progress,
          error: active.error,
          statistics: runManifest?.statistics ?? null,
          summary: runManifest?.summary ?? null,
          inspection: active.inspection?.jobId === jobId ? active.inspection : null,
        }),
      }
    : null;
  return {
    documentId: active.documentId,
    project: active.project,
    section: active.section,
    preparation: active.preparation,
    manifest,
    run,
    error: active.error,
    inspection: active.inspection ?? null,
  };
}
