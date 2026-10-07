import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ProjectDefinition } from '../domain/contracts/types';
import { cadDefinitionError } from '../domain/project/document';
import { assertCadNumericalGeometry } from '../domain/geometry/cadCompatibility';
import { sameSketchDefinition, type SketchSolveReport } from '../domain/geometry/sketchSolution';
import { type CadPreview } from '../domain/geometry/cadPreview';
import {
  evaluateCad,
  solveCadSketch,
  readCadBuffer,
  decodeCadDisplay,
  finishCad,
  cancelCad,
  importCadSource,
  exportCad,
  type CadReceipt,
} from '../platform/desktop/cad';
import type { WorkbenchActivity } from './workbenchActivity';
import {
  CadCommandOwnership,
  type CadCommandDraft,
  type CadCommandModel,
  type CadCommandRequest,
} from '../features/cad/commandDraft';
import { previewCadCommand } from './cadCommandPreview';

type Lease = {
  id: string;
  base: ProjectDefinition;
  snapshot: ProjectDefinition;
  cancelled: boolean;
  operation: 'evaluate' | 'preview' | 'solve-sketch' | 'import' | 'export';
};
interface Props {
  documentId: string;
  desktop: boolean;
  project: ProjectDefinition;
  projectRef: RefObject<ProjectDefinition>;
  activity: WorkbenchActivity;
  invalidDraftsRef: RefObject<Map<string, string>>;
  edit: (change: (project: ProjectDefinition) => void, physical?: boolean) => void;
  reportDraft: (id: string, label: string | null, markDirty?: boolean) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}

/** Owns one immutable CAD request and its publication, independently of tab focus. */
export function useCadSession(props: Props) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const lease = useRef<Lease | null>(null);
  const [busy, setBusy] = useState(false);
  const [commands] = useState(() => new CadCommandOwnership());
  const [commandDraft, setCommandDraft] = useState<CadCommandDraft | null>(null);
  const commandInputs = useRef(new Map<string, string>());
  const reportCommandInput = useCallback(
    (id: string, label: string | null) => {
      const p = callbacks.current;
      if (label === null) {
        const marker = commandInputs.current.get(id);
        if (marker) p.reportDraft(marker, null, false);
        commandInputs.current.delete(id);
        return;
      }
      const draft = commands.current();
      if (!draft) return;
      const marker = `${draft.markerId}:input:${id}`;
      commandInputs.current.set(id, marker);
      p.reportDraft(marker, label, false);
    },
    [commands],
  );
  const clearCommandMarkers = () => {
    const marker = commands.clear();
    if (marker) callbacks.current.reportDraft(marker, null, false);
    for (const input of commandInputs.current.values())
      callbacks.current.reportDraft(input, null, false);
    commandInputs.current.clear();
  };
  const [retained, setRetained] = useState<{
    receipt: CadReceipt;
    preview: CadPreview;
    source: string;
  } | null>(null);
  const [retainedSketch, setRetainedSketch] = useState<{
    projectId: string;
    featureId: string;
    source: string;
    report: SketchSolveReport;
  } | null>(null);
  const live = useRef(true);
  const current =
    retained &&
    retained.receipt.projectId === props.project.id &&
    retained.source === JSON.stringify(props.project.geometry)
      ? retained
      : null;
  const blocked = (ownMarker?: string, editingInputs = false) => {
    const p = callbacks.current,
      a = p.activity;
    // Local edits may finish one field while another command field is invalid.
    // Native preview and Apply never bypass these input markers.
    const editableInputs = editingInputs ? new Set(commandInputs.current.values()) : null;
    return (
      Array.from(p.invalidDraftsRef.current.keys()).some(
        (id) => id !== ownMarker && !editableInputs?.has(id),
      ) ||
      !!lease.current ||
      !!a.native.execution.current ||
      !!a.native.file.current ||
      !!a.native.device.current ||
      !!a.native.closing.current ||
      !!a.native.cad?.current ||
      !!a.recovery.current ||
      a.confirmation.current
    );
  };
  const acquire = (operation: Lease['operation'], draft?: CadCommandRequest): Lease | null => {
    const p = callbacks.current,
      a = p.activity;
    const ownsDraft =
      operation === 'preview' && draft && commands.owns(draft, p.projectRef.current);
    if (operation === 'preview' && !ownsDraft) return null;
    if (!p.desktop || blocked(ownsDraft ? commands.current()!.markerId : undefined)) return null;
    const base = structuredClone(p.projectRef.current);
    const next = {
      id: crypto.randomUUID(),
      base,
      snapshot: draft ? { ...base, geometry: structuredClone(draft.geometry), study: null } : base,
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
    callbacks.current.projectRef.current.id === request.base.id &&
    callbacks.current.projectRef.current.revision === request.base.revision &&
    JSON.stringify(callbacks.current.projectRef.current.geometry) ===
      JSON.stringify(request.base.geometry);
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
        if (['evaluate', 'preview', 'solve-sketch'].includes(request.operation))
          void cancelCad(request.id).catch(() => {});
        release(request);
      }
      clearCommandMarkers();
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
  const solveSketch = async (featureId: string) => {
    const p = callbacks.current,
      request = acquire('solve-sketch');
    if (!request) return;
    try {
      const solution = await solveCadSketch(request.snapshot, featureId, request.id, p.documentId);
      if (!owns(request)) return;
      // Release the native edit gate before one canonical history transaction.
      release(request);
      const authored =
        request.snapshot.geometry.kind === 'cad'
          ? request.snapshot.geometry.features.find((item) => item.id === featureId)
          : null;
      if (
        ['solved', 'redundant'].includes(solution.report.status) &&
        authored?.kind === 'sketch' &&
        !sameSketchDefinition(authored.sketch, solution.sketch)
      ) {
        p.edit((next) => {
          if (next.geometry.kind === 'cad') {
            const feature = next.geometry.features.find((item) => item.id === featureId);
            if (feature?.kind === 'sketch') feature.sketch = structuredClone(solution.sketch);
          }
        });
      }
      const project = callbacks.current.projectRef.current;
      const feature =
        project.geometry.kind === 'cad'
          ? project.geometry.features.find((item) => item.id === featureId)
          : null;
      if (
        !live.current ||
        project.id !== request.snapshot.id ||
        feature?.kind !== 'sketch' ||
        !sameSketchDefinition(feature.sketch, solution.sketch)
      )
        return;
      setRetainedSketch({
        projectId: project.id,
        featureId,
        source: JSON.stringify(feature.sketch),
        report: solution.report,
      });
      p.onNotice(
        solution.report.status === 'solved'
          ? `Sketch solved · ${solution.report.degreesOfFreedom} degrees of freedom.`
          : `Sketch solver: ${solution.report.status}. Review its constraint diagnostics.`,
      );
    } catch (error) {
      if (owns(request)) p.onError(String(error));
    } finally {
      release(request);
    }
  };
  const cancel = async () => {
    const request = lease.current;
    if (!request || !['evaluate', 'preview', 'solve-sketch'].includes(request.operation)) return;
    request.cancelled = true;
    try {
      await cancelCad(request.id);
      if (live.current)
        callbacks.current.onNotice('CAD evaluation cancelled; the prior definition is preserved.');
    } catch (error) {
      if (live.current) callbacks.current.onError(`CAD cancellation failed: ${String(error)}`);
    }
  };
  const cancelCommand = async () => {
    clearCommandMarkers();
    if (live.current) setCommandDraft(null);
    if (lease.current?.operation === 'preview') await cancel();
  };
  useEffect(() => {
    if (commands.current() && !commands.matches(props.project)) void cancelCommand();
  }, [props.project.id, props.project.revision, props.project.geometry]);
  const command: CadCommandModel = {
    draft: commands.matches(props.project) ? commandDraft : null,
    inputBlocked: Array.from(props.invalidDraftsRef.current.keys()).some(
      (id) => id !== commands.current()?.markerId,
    ),
    reportInputDraft: reportCommandInput,
    start(geometry, featureId, label) {
      const p = callbacks.current;
      if (blocked() || !commands.begin(p.projectRef.current, geometry, featureId, label))
        return false;
      const draft = commands.current()!;
      p.reportDraft(draft.markerId, label, false);
      p.onError(null);
      setCommandDraft(draft);
      return true;
    },
    update(change) {
      const draft = commands.current();
      if (
        !draft ||
        blocked(draft.markerId, true) ||
        !commands.matches(callbacks.current.projectRef.current)
      )
        return;
      if (commands.update(change)) setCommandDraft(commands.current());
    },
    async preview() {
      const p = callbacks.current,
        draft = commands.current();
      if (!draft || blocked(draft.markerId)) return false;
      const invalid = cadDefinitionError(draft.geometry);
      if (invalid) {
        p.onError(invalid);
        return false;
      }
      if (!p.desktop) {
        p.onError('Open the desktop app to preview and apply exact CAD commands.');
        return false;
      }
      const ticket = commands.request(p.projectRef.current);
      if (!ticket) return false;
      setCommandDraft(commands.current());
      const request = acquire('preview', ticket);
      if (!request) {
        commands.complete(
          ticket,
          p.projectRef.current,
          null,
          'The CAD worker is busy. Retry preview.',
        );
        setCommandDraft(commands.current());
        return false;
      }
      try {
        const preview = await previewCadCommand(
          request.snapshot,
          request.id,
          p.documentId,
          () => owns(request) && commands.owns(ticket, callbacks.current.projectRef.current),
          {
            evaluate: evaluateCad,
            read: readCadBuffer,
            decode: decodeCadDisplay,
            finish: finishCad,
          },
        );
        const published = commands.complete(ticket, callbacks.current.projectRef.current, preview);
        if (live.current) setCommandDraft(commands.current());
        return published && !!preview;
      } catch (error) {
        if (commands.complete(ticket, callbacks.current.projectRef.current, null, String(error))) {
          if (live.current) setCommandDraft(commands.current());
          p.onError(String(error));
        }
        return false;
      } finally {
        release(request);
      }
    },
    apply() {
      const p = callbacks.current,
        draft = commands.current();
      if (!draft || blocked(draft.markerId)) return false;
      const geometry = commands.candidate(p.projectRef.current);
      if (!geometry) return false;
      p.edit((next) => {
        next.geometry = geometry;
      });
      if (JSON.stringify(p.projectRef.current.geometry) !== JSON.stringify(geometry)) return false;
      clearCommandMarkers();
      setCommandDraft(null);
      p.onNotice('Command applied. Rebuild the committed geometry before analysis or export.');
      return true;
    },
    cancel: cancelCommand,
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
        analysisCompatibility: current.receipt.analysisCompatibility,
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
  const retainedPreview =
    retained?.receipt.projectId === props.project.id && props.project.geometry.kind === 'cad'
      ? retained.preview
      : null;
  const sketchSolve = useMemo(() => {
    const solvedFeature =
      props.project.geometry.kind === 'cad'
        ? props.project.geometry.features.find(
            (feature) => feature.id === retainedSketch?.featureId,
          )
        : null;
    return retainedSketch?.projectId === props.project.id &&
      solvedFeature?.kind === 'sketch' &&
      retainedSketch.source === JSON.stringify(solvedFeature.sketch)
      ? { featureId: retainedSketch.featureId, report: retainedSketch.report }
      : null;
  }, [retainedSketch, props.project.id, props.project.geometry]);
  return {
    busy,
    cancellable:
      !!lease.current && ['evaluate', 'preview', 'solve-sketch'].includes(lease.current.operation),
    command,
    current,
    evaluation,
    retainedPreview,
    sketchSolve,
    solveSketch,
    evaluate,
    cancel,
    importSource,
    exportShape,
  };
}
