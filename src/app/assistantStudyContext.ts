import type { AssistantCadSnapshot, AssistantRunSnapshot } from '../domain/assistant/types';
import type { AssistantStudyContext } from '../features/assistant/context';
import type { ProjectDocumentSnapshot } from './projectDocuments';

function cadSnapshot(
  project: ProjectDocumentSnapshot['project'],
  cad?: ProjectDocumentSnapshot['cad'],
): AssistantCadSnapshot | null {
  const geometry = project.geometry;
  if (geometry.kind !== 'cad' && geometry.kind !== 'empty') return null;
  const features = geometry.kind === 'cad' ? geometry.features : [];
  const outputFeatureId = geometry.kind === 'cad' ? geometry.outputFeatureId : null;
  const receipt =
    geometry.kind === 'cad' &&
    cad?.receipt?.projectId === project.id &&
    cad.receipt.revision <= project.revision &&
    cad.receipt.outputFeatureId === outputFeatureId
      ? cad.receipt
      : null;
  const sketches =
    receipt?.features.flatMap((feature) => {
      const report = feature.sketch;
      if (feature.kind !== 'sketch' || !report || typeof report !== 'object') return [];
      const record = report as Record<string, unknown>;
      const failed = Array.isArray(record.failedConstraintIds)
        ? record.failedConstraintIds.filter((id): id is string => typeof id === 'string')
        : [];
      return [
        {
          featureId: feature.id,
          status: typeof record.status === 'string' ? record.status.slice(0, 64) : 'unavailable',
          degreesOfFreedom:
            typeof record.degreesOfFreedom === 'number' &&
            Number.isSafeInteger(record.degreesOfFreedom) &&
            record.degreesOfFreedom >= 0
              ? record.degreesOfFreedom
              : null,
          failedConstraintIds: failed.slice(0, 8),
          failedConstraintCount: failed.length,
        },
      ];
    }) ?? [];
  return {
    state: cad?.busy ? 'busy' : receipt ? 'current' : 'unevaluated',
    dimension: geometry.dimension,
    outputFeatureId,
    featureCount: features.length,
    sketchCount: features.filter((feature) => feature.kind === 'sketch').length,
    assetCount: geometry.kind === 'cad' ? geometry.assets.length : 0,
    sketchSolve:
      cad?.sketchSolve &&
      features.some(
        (feature) => feature.kind === 'sketch' && feature.id === cad.sketchSolve!.featureId,
      )
        ? {
            featureId: cad.sketchSolve.featureId,
            status: cad.sketchSolve.report.status,
            degreesOfFreedom: cad.sketchSolve.report.degreesOfFreedom,
            failedConstraintIds: cad.sketchSolve.report.failedConstraintIds.slice(0, 32),
            failedConstraintCount: cad.sketchSolve.report.failedConstraintIds.length,
            kernel: cad.sketchSolve.report.kernel,
            sourceCommit: cad.sketchSolve.report.sourceCommit,
          }
        : null,
    evaluation: receipt
      ? {
          jobId: receipt.jobId,
          revision: receipt.revision,
          geometryFingerprint: receipt.geometryFingerprint,
          outputFeatureId: receipt.outputFeatureId,
          summary: JSON.stringify({
            coordinateFrame: receipt.coordinateFrame,
            kernel: receipt.kernel,
            measurementsSI: {
              bounds: receipt.statistics.bounds,
              surfaceArea: receipt.statistics.surfaceArea,
              volume: receipt.statistics.volume,
              faceCount: receipt.statistics.faceCount,
              edgeCount: receipt.statistics.edgeCount,
              bodyCount: receipt.statistics.bodyCount,
            },
            analysisCompatibility: {
              state: receipt.analysisCompatibility.state,
              dimension: receipt.analysisCompatibility.dimension,
              methodIds: receipt.analysisCompatibility.methodIds,
              reason: receipt.analysisCompatibility.reason,
            },
            evaluatedFeatureIds: receipt.features.map((feature) => feature.id),
            sketches: sketches.slice(0, 16),
            sketchReportCount: sketches.length,
            omittedSketchReportCount: Math.max(0, sketches.length - 16),
            diagnostics: receipt.diagnostics.slice(0, 8).map((diagnostic) => ({
              code: diagnostic.code,
              severity: diagnostic.severity,
              message: diagnostic.message.slice(0, 500),
              messageTruncated: diagnostic.message.length > 500,
            })),
            diagnosticCount: receipt.diagnostics.length,
            omittedDiagnosticCount: Math.max(0, receipt.diagnostics.length - 8),
            scope:
              'Exact evaluated CAD output only. analysisCompatibility describes primitive adapters; a separate cad-solid study requires current source and face-catalog verification. Display triangles are not an analysis mesh; eligibility and sketch DOF do not prove physical correctness. Only features in the selected output dependency closure were evaluated.',
          }),
        }
      : null,
  };
}

export function assistantStudyContext(
  active:
    | (Pick<
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
      > &
        Partial<Pick<ProjectDocumentSnapshot, 'cad'>>)
    | null,
): AssistantStudyContext | null {
  if (!active) return null;
  const manifest = active.project.study
    ? (active.currentData?.manifest ?? active.runExecution?.manifest ?? null)
    : null;
  const jobId = active.runExecution ? active.runExecution.jobId : manifest?.jobId;
  const runManifest = active.runExecution
    ? active.runExecution.manifest?.jobId === jobId
      ? active.runExecution.manifest
      : null
    : manifest;
  const matches =
    !!runManifest &&
    runManifest.projectId === active.project.id &&
    runManifest.studyId === active.project.study?.id &&
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
  const runStudyId =
    active.runExecution?.project.study.id ?? runManifest?.studyId ?? active.project.study?.id;
  const run: AssistantRunSnapshot | null =
    jobId && runStudyId && runStudyId === active.project.study?.id
      ? {
          jobId,
          studyId: runStudyId,
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
    cad: cadSnapshot(active.project, active.cad),
  };
}
