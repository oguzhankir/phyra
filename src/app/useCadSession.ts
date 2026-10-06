import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ProjectDefinition } from '../domain/contracts/types';
import { cadDefinitionError } from '../domain/project/document';
import { assertCadNumericalGeometry } from '../domain/geometry/cadCompatibility';
import { type CadPreview } from '../domain/geometry/cadPreview';
import {
  evaluateCad,
  readCadBuffer,
  decodeCadDisplay,
  finishCad,
  cancelCad,
  importCadSource,
  exportCad,
  type CadReceipt,
} from '../platform/desktop/cad';
import type { WorkbenchActivity } from './workbenchActivity';

type Lease = {
  id: string;
  snapshot: ProjectDefinition;
  cancelled: boolean;
  operation: 'evaluate' | 'import' | 'export';
};
interface Props {
  documentId: string;
  desktop: boolean;
  project: ProjectDefinition;
  projectRef: RefObject<ProjectDefinition>;
  activity: WorkbenchActivity;
  invalidDraftsRef: RefObject<Map<string, string>>;
  edit: (change: (project: ProjectDefinition) => void, physical?: boolean) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}

/** Owns one immutable CAD request and its publication, independently of tab focus. */
export function useCadSession(props: Props) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const lease = useRef<Lease | null>(null);
  const [busy, setBusy] = useState(false);
  const [retained, setRetained] = useState<{
    receipt: CadReceipt;
    preview: CadPreview;
    source: string;
  } | null>(null);
  const live = useRef(true);
  const current =
    retained &&
    retained.receipt.projectId === props.project.id &&
    retained.source === JSON.stringify(props.project.geometry)
      ? retained
      : null;
  const acquire = (operation: Lease['operation']): Lease | null => {
    const p = callbacks.current,
      a = p.activity;
    if (
      !p.desktop ||
      p.invalidDraftsRef.current.size > 0 ||
      lease.current ||
      a.native.execution.current ||
      a.native.file.current ||
      a.native.device.current ||
      a.native.closing.current ||
      a.native.cad?.current ||
      a.recovery.current ||
      a.confirmation.current
    )
      return null;
    const next = {
      id: crypto.randomUUID(),
      snapshot: structuredClone(p.projectRef.current),
      cancelled: false,
      operation,
    };
    lease.current = next;
    if (a.cad) a.cad.current = true;
    if (a.native.cad) a.native.cad.current = next.id;
    setBusy(true);
    p.onError(null);
    return next;
  };
  const owns = (request: Lease) =>
    live.current &&
    lease.current === request &&
    !request.cancelled &&
    callbacks.current.projectRef.current.id === request.snapshot.id &&
    callbacks.current.projectRef.current.revision === request.snapshot.revision &&
    JSON.stringify(callbacks.current.projectRef.current.geometry) ===
      JSON.stringify(request.snapshot.geometry);
  const release = (request: Lease) => {
    if (lease.current !== request) return;
    lease.current = null;
    const a = callbacks.current.activity;
    if (a.cad) a.cad.current = false;
    if (a.native.cad?.current === request.id) a.native.cad.current = null;
    if (live.current) setBusy(false);
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      const request = lease.current;
      if (request) {
        request.cancelled = true;
        if (request.operation === 'evaluate') void cancelCad(request.id).catch(() => {});
        release(request);
      }
    };
  }, []);
  const evaluate = async (): Promise<boolean> => {
    const p = callbacks.current;
    if (p.projectRef.current.geometry.kind !== 'cad') return false;
    if (p.invalidDraftsRef.current.size) {
      p.onError('Apply, complete or revert the active draft before evaluating CAD geometry.');
      return false;
    }
    const invalid = cadDefinitionError(p.projectRef.current.geometry);
    if (invalid) {
      p.onError(invalid);
      return false;
    }
    const request = acquire('evaluate');
    if (!request) return false;
    let receipt: CadReceipt | null = null,
      accepted = false;
    try {
      receipt = await evaluateCad(request.snapshot, request.id, p.documentId);
      if (receipt.analysisCompatibility.state === 'supported') {
        if (
          request.snapshot.geometry.kind !== 'cad' ||
          receipt.analysisCompatibility.dimension !== request.snapshot.geometry.dimension
        )
          throw new Error('CAD analysis projection dimension does not match its source.');
        assertCadNumericalGeometry(receipt.analysisCompatibility.numericalGeometry);
      }
      const buffer = await readCadBuffer(receipt.jobId, p.documentId);
      const display = await decodeCadDisplay(receipt, buffer);
      const preview = {
        ...display,
        faces: receipt.faces,
        edges: receipt.edges,
        bodies: receipt.bodies,
      };
      if (!owns(request)) return false;
      await finishCad(receipt.jobId, p.documentId, true);
      accepted = true;
      if (!owns(request)) return false;
      setRetained({ receipt, preview, source: JSON.stringify(request.snapshot.geometry) });
      p.onNotice('Exact CAD geometry evaluated. Review analysis compatibility before proceeding.');
      return true;
    } catch (error) {
      if (owns(request)) p.onError(String(error));
      return false;
    } finally {
      if (receipt && !accepted)
        await finishCad(receipt.jobId, p.documentId, false).catch((error) => {
          if (live.current) p.onError(`CAD cleanup failed: ${String(error)}`);
        });
      release(request);
    }
  };
  const cancel = async () => {
    const request = lease.current;
    if (!request || request.operation !== 'evaluate') return;
    request.cancelled = true;
    try {
      await cancelCad(request.id);
      if (live.current)
        callbacks.current.onNotice('CAD evaluation cancelled; the prior definition is preserved.');
    } catch (error) {
      if (live.current) callbacks.current.onError(`CAD cancellation failed: ${String(error)}`);
    }
  };
  const importSource = async () => {
    const p = callbacks.current,
      request = acquire('import');
    if (!request) return;
    try {
      const asset = await importCadSource(p.documentId);
      if (!asset || !owns(request)) return;
      release(request);
      p.edit((next) => {
        const id = `import_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
        const feature = {
          id,
          name: asset.originalName,
          kind: 'import-step' as const,
          assetId: asset.id,
          scaleFactor: 1,
        };
        if (next.geometry.kind === 'cad') {
          if (!next.geometry.assets.some((item) => item.id === asset.id))
            next.geometry.assets.push(asset);
          next.geometry.features.push(feature);
          next.geometry.outputFeatureId = id;
        } else
          next.geometry = {
            kind: 'cad',
            dimension: '3d',
            features: [feature],
            outputFeatureId: id,
            assets: [asset],
          };
      });
      p.onNotice('STEP source imported into this project. Evaluate to validate the exact shape.');
    } catch (error) {
      if (owns(request)) p.onError(String(error));
    } finally {
      release(request);
    }
  };
  const exportShape = async (format: 'step' | 'brep', units: 'm' | 'mm') => {
    if (!current) return;
    const p = callbacks.current,
      request = acquire('export');
    if (!request) return;
    try {
      const path = await exportCad(current.receipt.jobId, p.documentId, format, units);
      if (path && owns(request))
        p.onNotice(`Exported ${format.toUpperCase()} geometry in ${units}.`);
    } catch (error) {
      if (owns(request)) p.onError(String(error));
    } finally {
      release(request);
    }
  };
  const evaluation = current
    ? {
        preview: current.preview,
        kernel: `${current.receipt.kernel.name} ${current.receipt.kernel.version}`,
        ...current.receipt.statistics,
        sketches: current.receipt.features.flatMap((feature) => {
          const report = feature.sketch;
          if (!report || typeof report !== 'object') return [];
          const record = report as Record<string, unknown>;
          return [
            {
              featureId: feature.id,
              status: String(record.status),
              degreesOfFreedom:
                typeof record.degreesOfFreedom === 'number' ? record.degreesOfFreedom : null,
              failedConstraintIds: Array.isArray(record.failedConstraintIds)
                ? record.failedConstraintIds.filter((id): id is string => typeof id === 'string')
                : [],
            },
          ];
        }),
      }
    : null;
  return { busy, current, evaluation, evaluate, cancel, importSource, exportShape };
}
