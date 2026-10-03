import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';
import {
  invokeVerification as invoke,
  type VerificationConfiguration,
} from '../platform/desktop/verification';
import type { Project, TrainingMetric } from '../domain/contracts/types';
import type { ResultData, FieldId, FieldSource } from '../domain/results/fields';
import { makeProject } from '../features/examples/projects';

export function verificationProject(configuration: NonNullable<VerificationConfiguration>) {
  const next = makeProject(
    configuration === '2d-profile'
      ? 'kirsch-quarter'
      : configuration === '2d-energy'
        ? 'energy-tension'
        : configuration === '2d-compare'
          ? 'plane-stress-tension'
          : 'cantilever',
  );
  if (configuration === '2d-compare' || configuration === '2d-energy') {
    next.study.solver.kind = 'pinn';
    next.study.solver.pinn.layers = 2;
    next.study.solver.pinn.width = 16;
    next.study.solver.pinn.steps = configuration === '2d-energy' ? 1200 : 2000;
    next.study.solver.pinn.interiorPoints = configuration === '2d-energy' ? 1024 : 128;
    next.study.solver.pinn.boundaryPoints = configuration === '2d-energy' ? 64 : 32;
    next.study.solver.pinn.device = 'cpu';
  }
  return next;
}

function isComparison(configuration: VerificationConfiguration) {
  return configuration === '2d-compare' || configuration === '2d-energy';
}
type Props = {
  desktop: boolean;
  project: Project;
  currentData: ResultData | null;
  liveMetrics: RefObject<TrainingMetric[]>;
  fieldSource: FieldSource;
  fieldId: FieldId;
  replace: (project: Project, data?: ResultData | null) => void;
  setDeformation: Dispatch<SetStateAction<'off' | 'actual' | 'auto' | 'custom'>>;
  setFieldId: Dispatch<SetStateAction<FieldId>>;
  setFieldSource: Dispatch<SetStateAction<FieldSource>>;
  setError: (value: string | null) => void;
};
export function useVerificationWorkflow({
  desktop,
  project,
  currentData,
  liveMetrics,
  fieldSource,
  fieldId,
  replace,
  setDeformation,
  setFieldId,
  setFieldSource,
  setError,
}: Props) {
  const [verification, setVerification] = useState(false);
  const verificationStarted = useRef(false);
  const verificationSent = useRef(false);
  const [verificationConfiguration, setVerificationConfiguration] =
    useState<VerificationConfiguration>(null);
  const verificationReports = useRef<Record<string, Record<string, unknown>>>({});
  const verificationDisplacement = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!desktop || verificationStarted.current) return;
    verificationStarted.current = true;
    void invoke('verification_trace', { message: 'frontend verification hook mounted' });
    void invoke('verification_configuration')
      .then((configuration) => {
        if (configuration) {
          void invoke('verification_trace', {
            message: `frontend verification configuration: ${configuration}`,
          });
          replace(verificationProject(configuration));
          setDeformation('actual');
          setVerificationConfiguration(configuration);
          setVerification(true);
        }
      })
      .catch((cause) => {
        void invoke('verification_trace', {
          message: `frontend verification config failed: ${String(cause)}`,
        });
        setError(String(cause));
      });
  }, [desktop]);
  const verified = (report: Record<string, unknown>) => {
    if (!verification || verificationSent.current || !currentData) return;
    void invoke('verification_trace', { message: `frontend rendered ${fieldId}` });
    if (isComparison(verificationConfiguration)) {
      const reports = verificationReports.current;
      if (fieldSource === 'fem' && fieldId === 'displacement-mag') {
        reports.renderer = report;
        setFieldId('vonMises');
        return;
      }
      if (fieldSource === 'fem' && fieldId === 'vonMises') {
        reports.stressRenderer = { ...report, viewportPng: null };
        setFieldSource('pinn');
        setFieldId('displacement-mag');
        return;
      }
      if (fieldSource === 'pinn') {
        reports.pinnRenderer = { ...report, viewportPng: null };
        setFieldSource('difference');
        return;
      }
      if (fieldSource === 'difference') {
        reports.differenceRenderer = { ...report, viewportPng: null };
        verificationSent.current = true;
        void invoke('verification_complete', {
          report: {
            project,
            manifest: currentData.manifest,
            ...reports,
            metrics: {
              count: liveMetrics.current.length,
              first: liveMetrics.current[0],
              last: liveMetrics.current.at(-1),
            },
          },
        }).catch((cause) => setError(String(cause)));
      }
      return;
    }
    if (!verificationDisplacement.current) {
      verificationDisplacement.current = report;
      setFieldId('vonMises');
      return;
    }
    if (fieldId !== 'vonMises') return;
    verificationSent.current = true;
    void invoke('verification_complete', {
      report: {
        project,
        manifest: currentData.manifest,
        renderer: verificationDisplacement.current,
        stressRenderer: { ...report, viewportPng: null },
      },
    }).catch((cause) => setError(String(cause)));
  };
  const requestedOperation: 'solve' | 'compare' | null =
    verification && verificationConfiguration
      ? isComparison(verificationConfiguration)
        ? 'compare'
        : 'solve'
      : null;
  return { verification, verified, requestedOperation };
}
