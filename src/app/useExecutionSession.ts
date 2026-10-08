import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  Devices,
  Manifest,
  Operation,
  Progress,
  ProjectDefinition,
  Project,
  TrainingMetric,
} from '../domain/contracts/types';
import {
  appendTrainingMetric,
  resultIsCurrent,
  type RunExecution,
  type RunStatus,
} from '../domain/execution/presentation';
import { supportsPinn } from '../domain/project/study';
import { isNumericalProject } from '../domain/project/document';
import type { CadSolidSource } from '../domain/project/cadSolid';
import { prepareStudy } from '../domain/project/readiness';
import type { ResultData } from '../domain/results/fields';
import type { RunTab } from '../features/runs/RunWorkspace';
import {
  cancelJob,
  finishResult,
  getDevices,
  readBuffer,
  runJob,
  subscribeMetrics,
  subscribeProgress,
} from '../platform/desktop/bridge';
import { invokeVerification as invoke } from '../platform/desktop/verification';
import { ExecutionOwnership } from './executionOwnership';
import { receiveExecutionResult } from './executionPublication';
import type { WorkbenchActivity } from './workbenchActivity';

interface Props {
  documentId: string;
  desktop: boolean;
  verificationRef: RefObject<boolean>;
  activity: WorkbenchActivity;
  project: ProjectDefinition;
  analysisProject?: Project | null;
  cadSource?: CadSolidSource | null;
  projectRef: RefObject<ProjectDefinition>;
  invalidDraftsRef: RefObject<Map<string, string>>;
  initialData?: ResultData | null;
  onStart: (operation: Operation) => void;
  onComplete: (manifest: Manifest) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}

// Owns current/retained fields, native worker identity, run metrics and probed devices.
// Views receive state and actions; they cannot publish a result or acquire a worker.
export function useExecutionSession(props: Props) {
  const { desktop, activity, project, projectRef, invalidDraftsRef, verificationRef } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const busyRef = activity.execution;
  const fileBusyRef = activity.file;
  const deviceBusyRef = activity.device;
  const recoveryBusyRef = activity.recovery;
  const confirmationRef = activity.confirmation;
  const [data, setData] = useState<ResultData | null>(() => props.initialData ?? null);
  const currentData = resultIsCurrent(project, data) ? data : null;
  const [busy, setBusy] = useState<Operation | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [devices, setDevices] = useState<Devices | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TrainingMetric[]>([]);
  const liveMetrics = useRef<TrainingMetric[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [runExecution, setRunExecution] = useState<RunExecution | null>(null);
  const [runElapsed, setRunElapsed] = useState(0);
  const runStarted = useRef<number | null>(null);
  const [runTab, setRunTab] = useState<RunTab>('run');
  const [runExpanded, setRunExpanded] = useState(false);
  const ownership = useRef(new ExecutionOwnership());
  const reset = (result: ResultData | null) => {
    setData(result);
    setMetrics([]);
    liveMetrics.current = [];
    setRunStatus('idle');
    setRunExecution(null);
    setRunElapsed(0);
    setRunTab('run');
    setProgress(null);
  };
  const execute = async (operation: Operation) => {
    if (
      !desktop ||
      activity.cad?.current ||
      busyRef.current ||
      fileBusyRef.current ||
      confirmationRef.current ||
      invalidDraftsRef.current.size ||
      deviceBusyRef.current ||
      recoveryBusyRef.current
    )
      return;
    if (
      activity.native.cad?.current ||
      activity.native.execution.current ||
      activity.native.file.current ||
      activity.native.device.current ||
      activity.native.closing.current
    ) {
      callbacks.current.onNotice(
        'Another project is using the numerical worker or a native file operation. Wait for it to finish.',
      );
      return;
    }
    const numerical = isNumericalProject(project) ? project : callbacks.current.analysisProject;
    if (!numerical) {
      callbacks.current.onError(
        'This geometry has no supported numerical study. Review CAD compatibility first.',
      );
      return;
    }
    const preparation = prepareStudy(
      numerical,
      invalidDraftsRef.current.size,
      callbacks.current.cadSource,
    );
    if (operation === 'mesh' ? !preparation.canMesh : !preparation.canRun) {
      callbacks.current.onError(
        preparation.checks.find((check) => check.section === preparation.firstMissing)?.detail ??
          'Complete study preparation before computing.',
      );
      return;
    }
    if ((operation === 'train' || operation === 'compare') && !supportsPinn(numerical)) {
      callbacks.current.onError(
        'PINN training and comparison require a rectangular 2D study with force or pressure loads.',
      );
      return;
    }
    const snapshot = structuredClone(project);
    const job = ownership.current.begin(snapshot, operation);
    setRunExecution({ project: structuredClone(numerical), definition: snapshot, operation });
    setBusy(operation);
    busyRef.current = operation;
    activity.native.execution.current = operation;
    setCancelling(false);
    setProgress(null);
    callbacks.current.onError(null);
    callbacks.current.onNotice(null);
    callbacks.current.onStart(operation);
    setMetrics([]);
    liveMetrics.current = [];
    setRunStatus('preparing');
    runStarted.current = performance.now();
    setRunElapsed(0);
    if (operation === 'train' || operation === 'compare') {
      setRunExpanded(true);
      setRunTab('training');
    }
    try {
      const manifest = await runJob(operation, snapshot, job.requestId, props.documentId);
      if (verificationRef.current)
        void invoke('verification_trace', { message: 'frontend manifest received' });
      const received = await receiveExecutionResult(
        ownership.current,
        job,
        () => projectRef.current,
        manifest,
        {
          read: () => readBuffer(manifest.jobId, props.documentId),
          finish: (accept) => finishResult(manifest.jobId, props.documentId, accept),
          cleanupFailed: (cause) =>
            callbacks.current.onError(`Result cleanup failed: ${String(cause)}`),
        },
      );
      if (!received) return;
      if (verificationRef.current)
        void invoke('verification_trace', {
          message: `frontend buffer received ${received.buffer.byteLength}`,
        });
      setData(received);
      setRunExecution({
        project: structuredClone(numerical),
        definition: snapshot,
        operation,
        jobId: manifest.jobId,
        manifest,
      });
      if (verificationRef.current)
        void invoke('verification_trace', { message: 'frontend result set' });
      callbacks.current.onComplete(manifest);
      setRunStatus('completed');
      setRunExpanded(false);
      if (manifest.training) setMetrics(manifest.training.history);
      if (operation === 'compare') setRunTab('comparison');

      callbacks.current.onNotice(
        operation === 'train'
          ? 'PINN training complete'
          : operation === 'compare'
            ? 'FEM + PINN comparison complete'
            : operation === 'solve'
              ? 'Analysis complete'
              : 'Mesh generated',
      );
    } catch (cause) {
      await ownership.current.settleCancellation(job);
      if (!ownership.current.owns(job)) return;
      if (!job.cancelled) {
        setRunStatus('failed');
        callbacks.current.onError(String(cause));
        if (verificationRef.current)
          void invoke('verification_complete', { report: { error: String(cause) } });
      } else {
        setRunStatus('cancelled');
        callbacks.current.onNotice('Job cancelled; worker stopped');
      }
    } finally {
      await ownership.current.settleCancellation(job);
      if (ownership.current.finish(job)) {
        setBusy(null);
        busyRef.current = null;
        activity.native.execution.current = null;
        setCancelling(false);
        if (runStarted.current !== null)
          setRunElapsed((performance.now() - runStarted.current) / 1000);
      }
    }
  };
  const cancel = async () => {
    if (cancelling) return;
    const job = ownership.current.activeLease();
    if (!job) return;
    setCancelling(true);
    try {
      const stopped = await ownership.current.requestCancellation(job, () =>
        cancelJob(job.requestId),
      );
      if (!ownership.current.owns(job)) return;
      if (stopped) {
        setRunStatus('cancelled');
        callbacks.current.onNotice('Cancellation acknowledged; worker stopped');
      } else {
        setCancelling(false);
        callbacks.current.onNotice('The worker has finished; loading its completed result.');
      }
    } catch (cause) {
      if (!ownership.current.owns(job)) return;
      callbacks.current.onError(`Cancellation failed: ${String(cause)}`);
      setCancelling(false);
    }
  };
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let dead = false;
    subscribeProgress(({ requestId, payload: event }) => {
      const job = ownership.current.event(requestId, event.jobId);
      if (!job) return;
      setRunExecution((previous) => (previous ? { ...previous, jobId: event.jobId } : previous));
      setProgress(event);
      setRunStatus('running');
    })
      .then((unsubscribe) => {
        if (dead) unsubscribe();
        else dispose = unsubscribe;
      })
      .catch((cause) => callbacks.current.onError(`Progress connection failed: ${String(cause)}`));
    return () => {
      dead = true;
      dispose?.();
    };
  }, [desktop]);
  useEffect(() => {
    if (!desktop) return;
    let dead = false;
    let dispose: (() => void) | undefined;
    subscribeMetrics(({ requestId, payload: sample }) => {
      const job = ownership.current.event(requestId, sample.jobId);
      if (!job) return;
      setRunExecution((previous) => (previous ? { ...previous, jobId: sample.jobId } : previous));
      setRunStatus('running');
      liveMetrics.current = appendTrainingMetric(liveMetrics.current, sample, job.jobId);
      setMetrics((history) => appendTrainingMetric(history, sample, job.jobId));
    })
      .then((unsubscribe) => {
        if (dead) unsubscribe();
        else dispose = unsubscribe;
      })
      .catch((cause) =>
        callbacks.current.onError(`Training metric connection failed: ${String(cause)}`),
      );
    return () => {
      dead = true;
      dispose?.();
    };
  }, [desktop]);
  useEffect(() => {
    if (!busy) return;
    const interval = window.setInterval(() => {
      if (runStarted.current !== null)
        setRunElapsed((performance.now() - runStarted.current) / 1000);
    }, 500);
    return () => window.clearInterval(interval);
  }, [busy]);
  const refreshDevices = async () => {
    if (
      !desktop ||
      activity.cad?.current ||
      busyRef.current ||
      fileBusyRef.current ||
      deviceBusyRef.current ||
      activity.native.cad?.current ||
      activity.native.execution.current ||
      activity.native.file.current ||
      activity.native.device.current
    )
      return;
    deviceBusyRef.current = true;
    activity.native.device.current = true;
    setDeviceBusy(true);
    try {
      setDeviceError(null);
      const numerical = isNumericalProject(projectRef.current)
        ? projectRef.current
        : callbacks.current.analysisProject;
      if (!numerical) return;
      setDevices(await getDevices(structuredClone(numerical)));
    } catch (cause) {
      setDeviceError(String(cause));
      callbacks.current.onError(`Device detection failed: ${String(cause)}`);
    } finally {
      deviceBusyRef.current = false;
      activity.native.device.current = false;
      setDeviceBusy(false);
    }
  };
  return {
    data,
    currentData,
    busy,
    progress,
    cancelling,
    cancel,
    execute,
    reset,
    devices,
    deviceBusy,
    deviceError,
    refreshDevices,
    metrics,
    liveMetrics,
    runStatus,
    runExecution,
    runElapsed,
    runTab,
    setRunTab,
    runExpanded,
    setRunExpanded,
  };
}
export type ExecutionSession = ReturnType<typeof useExecutionSession>;
