import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Project, ProjectDefinition } from '../domain/contracts/types';
import type { ResultData } from '../domain/results/fields';
import { invokeVerification } from '../platform/desktop/verification';
import { readCadBuffer } from '../platform/desktop/cad';
import type { useCadSession } from './useCadSession';
import { cadVerificationCases } from './cadVerificationCases';

type Phase =
  | 'start'
  | 'advanced'
  | 'advanced-evaluated'
  | 'sketch'
  | 'sketch-solved'
  | 'base'
  | 'base-evaluated'
  | 'unsupported'
  | 'unsupported-evaluated'
  | 'restored'
  | 'restored-evaluated'
  | 'study'
  | 'mesh'
  | 'solve'
  | 'solved'
  | 'complete'
  | 'failed';
interface Props {
  enabled: boolean;
  documentId: string;
  ready: boolean;
  project: ProjectDefinition;
  projectRef: RefObject<ProjectDefinition>;
  analysisProject: Project | null;
  currentData: ResultData | null;
  cad: ReturnType<typeof useCadSession>;
  report: RefObject<Record<string, unknown> | null>;
  edit: (change: (project: ProjectDefinition) => void, physical?: boolean) => void;
  numericalEdit: (change: (project: Project) => void, physical?: boolean) => void;
  undo: () => void;
  createStudy: (
    material: { name: string; young: number; poisson: number },
    thickness: number,
    size: number,
  ) => void;
  execute: (operation: 'mesh' | 'solve') => Promise<void>;
  error: string | null;
}

/** A packaged desktop test drives the same canonical edit and native worker owners as the UI. */
export function useCadVerificationWorkflow(props: Props) {
  const current = useRef(props);
  current.current = props;
  const [phase, setPhase] = useState<Phase>('start');
  const [renderedTick, setRenderedTick] = useState(0);
  const pending = useRef(false),
    base = useRef<string | null>(null),
    previewRendered = useRef(false);
  const advancedIndex = useRef(0),
    advancedDefinitions = useRef<ProjectDefinition[]>([]);
  const advancedEvidence = useRef<Record<string, unknown>[]>([]);
  const evidence = useRef({
    emptyStart: false,
    commandPreviewIsolated: false,
    commandInputsBlocked: false,
    commandCancelPreserved: false,
    commandApplyOnce: false,
    openSketchSolved: false,
    evaluated: false,
    sourcePreserved: false,
    unsupportedBlocked: false,
    undoPreserved: false,
    previewRendered: false,
    meshGenerated: false,
  });
  const failed = async (message: string) => {
    setPhase('failed');
    await invokeVerification('verification_trace', { message: `CAD workflow failed: ${message}` });
    await invokeVerification('verification_complete', {
      report: {
        error: `CAD verification: ${message}`,
        project: current.current.projectRef.current,
      },
    });
  };
  useEffect(() => {
    if (
      !props.enabled ||
      !props.ready ||
      pending.current ||
      phase === 'complete' ||
      phase === 'failed'
    )
      return;
    const p = current.current;
    pending.current = true;
    const trace = (message: string) =>
      void invokeVerification('verification_trace', { message: `CAD workflow: ${message}` });
    let nextPhase: Phase | null = null;
    trace(`phase ${phase}`);
    void (async () => {
      switch (phase) {
        case 'start': {
          evidence.current.emptyStart =
            p.projectRef.current.geometry.kind === 'empty' && p.projectRef.current.study === null;
          if (!evidence.current.emptyStart) throw new Error('New document was not empty.');
          previewRendered.current = false;
          p.edit((next) => {
            next.geometry = cadVerificationCases()[0].geometry;
          });
          nextPhase = 'advanced';
          break;
        }
        case 'advanced':
          if (!(await p.cad.evaluate()))
            throw new Error('Advanced CAD evaluation did not publish.');
          nextPhase = 'advanced-evaluated';
          break;
        case 'advanced-evaluated': {
          if (!p.cad.current) {
            if (p.error) throw new Error(p.error);
            return;
          }
          const test = cadVerificationCases()[advancedIndex.current],
            receipt = p.cad.current.receipt;
          if (
            receipt.statistics.bodyCount !== test.bodies ||
            Math.abs(receipt.statistics.volume - test.volume) >
              Math.max(test.volume * 1e-9, 1e-15) ||
            receipt.analysisCompatibility.state !== 'unsupported' ||
            p.analysisProject !== null
          )
            throw new Error(
              `${test.name}: exact volume/body count or analysis gate disagrees with independent reference.`,
            );
          if (!previewRendered.current) return;
          if (
            test.name === 'assembly' &&
            (new Set(receipt.bodies.map((body) => body.componentId)).size !== 2 ||
              receipt.faces.some((face) => !receipt.bodies.some((body) => body.id === face.bodyId)))
          )
            throw new Error(
              'Assembly did not publish separate component identities and body mapping.',
            );
          advancedDefinitions.current.push(structuredClone(p.projectRef.current));
          advancedEvidence.current.push({
            name: test.name,
            jobId: receipt.jobId,
            volume: receipt.statistics.volume,
            bodyCount: receipt.statistics.bodyCount,
            rendered: true,
            unsupportedBlocked: true,
          });
          advancedIndex.current++;
          previewRendered.current = false;
          if (advancedIndex.current < cadVerificationCases().length) {
            p.edit((next) => {
              next.geometry = cadVerificationCases()[advancedIndex.current].geometry;
            });
            nextPhase = 'advanced';
            break;
          }
          const definition = p.projectRef.current;
          if (definition.study !== null)
            throw new Error('Advanced CAD unexpectedly created a study.');
          p.edit((next) => {
            next.geometry = {
              kind: 'cad',
              dimension: '3d',
              assets: [],
              outputFeatureId: 'verification-sketch',
              features: [
                {
                  id: 'verification-sketch',
                  name: 'Open sketch',
                  kind: 'sketch',
                  plane: 'xy',
                  sketch: {
                    points: [
                      { id: 'a', position: [0, 0] },
                      { id: 'b', position: [0.1, 0.02] },
                    ],
                    entities: [
                      { id: 'line', name: 'Line', kind: 'line', startId: 'a', endId: 'b' },
                    ],
                    constraints: [
                      { id: 'origin', kind: 'fixedPoint', pointId: 'a' },
                      { id: 'horizontal', kind: 'horizontal', lineId: 'line' },
                      {
                        id: 'length',
                        kind: 'distance',
                        firstPointId: 'a',
                        secondPointId: 'b',
                        value: 0.08,
                      },
                    ],
                    loops: [],
                  },
                },
              ],
            };
          });
          trace('empty document -> open constrained sketch');
          nextPhase = 'sketch';
          break;
        }
        case 'sketch':
          await p.cad.solveSketch('verification-sketch');
          nextPhase = 'sketch-solved';
          break;
        case 'sketch-solved': {
          const definition = p.projectRef.current;
          const feature =
            definition.geometry.kind === 'cad' ? definition.geometry.features[0] : null;
          const report = p.cad.sketchSolve;
          evidence.current.openSketchSolved =
            feature?.kind === 'sketch' &&
            feature.sketch.loops.length === 0 &&
            feature.sketch.constraints.length === 3 &&
            Math.abs(feature.sketch.points[1].position[0] - 0.08) < 1e-10 &&
            Math.abs(feature.sketch.points[1].position[1]) < 1e-10 &&
            report?.report.status === 'solved' &&
            report.report.degreesOfFreedom === 0 &&
            p.cad.current === null;
          if (!evidence.current.openSketchSolved) {
            if (p.error) throw new Error(p.error);
            throw new Error('Open sketch solve did not publish owned coordinates and DOF.');
          }
          p.edit((next) => {
            next.geometry = {
              kind: 'cad',
              dimension: '3d',
              features: [
                {
                  id: 'verification-box',
                  name: 'Verification box',
                  kind: 'box',
                  length: 0.1,
                  width: 0.05,
                  height: 0.025,
                },
              ],
              outputFeatureId: 'verification-box',
              assets: [],
            };
          });
          base.current = JSON.stringify(p.projectRef.current.geometry);
          trace('actual open sketch DOF/coordinates -> authored box');
          nextPhase = 'base';
          break;
        }
        case 'base':
          if (!(await p.cad.evaluate()))
            throw new Error('CAD evaluation did not publish an owned geometry receipt.');
          nextPhase = 'base-evaluated';
          break;
        case 'base-evaluated': {
          if (!p.cad.current) {
            if (p.error) throw new Error(p.error);
            return;
          }
          const receipt = p.cad.current.receipt;
          evidence.current.evaluated =
            receipt.analysisCompatibility.state === 'supported' && receipt.statistics.volume > 0;
          if (!evidence.current.evaluated) throw new Error('Exact box adapter was not supported.');
          if (!previewRendered.current) return;
          evidence.current.previewRendered = true;
          const before = structuredClone(p.projectRef.current);
          if (before.geometry.kind !== 'cad') throw new Error('CAD source lost.');
          const candidate = structuredClone(before.geometry);
          candidate.features.push(
            {
              id: 'verification-tool',
              name: 'Overlapping box',
              kind: 'box',
              length: 0.05,
              width: 0.04,
              height: 0.02,
            },
            {
              id: 'verification-union',
              name: 'Union',
              kind: 'boolean',
              operation: 'union',
              leftId: 'verification-box',
              rightId: 'verification-tool',
            },
          );
          candidate.outputFeatureId = 'verification-union';
          if (!p.cad.command.start(candidate, 'verification-union', 'Boolean union'))
            throw new Error('Command draft could not start.');
          p.cad.command.reportInputDraft('verification-size', 'Distance');
          evidence.current.commandInputsBlocked =
            !(await p.cad.command.preview()) && !p.cad.command.apply();
          if (!evidence.current.commandInputsBlocked)
            throw new Error('Unfinished numeric draft enabled command preview or Apply.');
          p.cad.command.reportInputDraft('verification-size', null);
          if (!(await p.cad.command.preview())) throw new Error('Command preview failed.');
          // A provisional exact shape must leave the accepted native receipt readable.
          const retainedBuffer = await readCadBuffer(receipt.jobId, p.documentId);
          evidence.current.commandPreviewIsolated =
            retainedBuffer.byteLength === receipt.byteLength &&
            JSON.stringify(p.projectRef.current) === JSON.stringify(before);
          if (!evidence.current.commandPreviewIsolated)
            throw new Error('Draft preview changed the project or replaced the accepted shape.');
          await p.cad.command.cancel();
          evidence.current.commandCancelPreserved =
            JSON.stringify(p.projectRef.current) === JSON.stringify(before);
          if (!evidence.current.commandCancelPreserved)
            throw new Error('Cancelling a command changed the authored project.');
          if (!p.cad.command.start(candidate, 'verification-union', 'Boolean union'))
            throw new Error('Second command draft could not start after cancellation.');
          if (!(await p.cad.command.preview()) || !p.cad.command.apply())
            throw new Error('Verified command could not apply.');
          evidence.current.commandApplyOnce =
            p.projectRef.current.revision === before.revision + 1 &&
            JSON.stringify(p.projectRef.current.geometry) === JSON.stringify(candidate);
          if (!evidence.current.commandApplyOnce)
            throw new Error('Command Apply did not produce one authored revision.');
          trace('provisional exact preview -> cancel preserves source -> one Apply transaction');
          nextPhase = 'unsupported';
          break;
        }
        case 'unsupported':
          if (!(await p.cad.evaluate()))
            throw new Error('CAD evaluation did not publish an owned geometry receipt.');
          nextPhase = 'unsupported-evaluated';
          break;
        case 'unsupported-evaluated': {
          if (!p.cad.current) {
            if (p.error) throw new Error(p.error);
            return;
          }
          evidence.current.unsupportedBlocked =
            p.cad.current.receipt.analysisCompatibility.state === 'unsupported' &&
            p.project.study === null &&
            p.analysisProject === null;
          if (!evidence.current.unsupportedBlocked)
            throw new Error('Unsupported exact Boolean was allowed into a study.');
          const revision = p.projectRef.current.revision;
          p.undo();
          evidence.current.undoPreserved =
            JSON.stringify(p.projectRef.current.geometry) === base.current &&
            p.projectRef.current.revision > revision;
          if (!evidence.current.undoPreserved)
            throw new Error('Undo did not restore the authored source.');
          trace('unsupported analysis gate verified -> undo restores source');
          nextPhase = 'restored';
          break;
        }
        case 'restored':
          if (!(await p.cad.evaluate()))
            throw new Error('CAD evaluation did not publish an owned geometry receipt.');
          nextPhase = 'restored-evaluated';
          break;
        case 'restored-evaluated': {
          if (!p.cad.current) {
            if (p.error) throw new Error(p.error);
            return;
          }
          if (p.cad.current.receipt.analysisCompatibility.state !== 'supported')
            throw new Error('Restored source is not supported.');
          p.createStudy(
            { name: 'Verification elastic material', young: 210e9, poisson: 0.3 },
            1,
            0.01,
          );
          trace('explicit material + mesh -> create study');
          nextPhase = 'study';
          break;
        }
        case 'study': {
          if (!p.analysisProject) return;
          p.numericalEdit((next) => {
            next.study.constraints.push({
              id: 'verification-support',
              name: 'Fixed end',
              regions: ['x0'],
              components: [0, 0, 0],
            });
            next.study.loads.push({
              id: 'verification-load',
              name: 'Axial force',
              regions: ['x1'],
              kind: 'force',
              vector: [1000, 0, 0],
              pressure: 0,
            });
          });
          evidence.current.sourcePreserved =
            JSON.stringify(p.projectRef.current.geometry) === base.current;
          if (!evidence.current.sourcePreserved)
            throw new Error('Study preparation replaced the CAD source.');
          nextPhase = 'mesh';
          break;
        }
        case 'mesh':
          await p.execute('mesh');
          nextPhase = 'solve';
          break;
        case 'solve': {
          if (!p.currentData || p.currentData.manifest.operation !== 'mesh') {
            if (p.error) throw new Error(p.error);
            return;
          }
          evidence.current.meshGenerated = true;
          p.report.current = {
            ...evidence.current,
            advanced: advancedEvidence.current,
            advancedDefinitions: advancedDefinitions.current,
            jobId: p.cad.current?.receipt.jobId,
            exportIntegrity: false,
          };
          trace('CAD source -> mesh -> solve');
          await p.execute('solve');
          nextPhase = 'solved';
          break;
        }
        case 'solved':
          if (!p.currentData || p.currentData.manifest.operation !== 'solve') {
            if (p.error) throw new Error(p.error);
            return;
          }
          nextPhase = 'complete';
          break;
      }
    })()
      .catch((error) => {
        nextPhase = null;
        return failed(String(error));
      })
      .finally(() => {
        // The next phase must observe an unlocked transaction even if React flushed its edits early.
        pending.current = false;
        if (nextPhase) setPhase(nextPhase);
      });
  }, [
    props.enabled,
    props.ready,
    phase,
    props.project,
    props.cad.current,
    props.currentData,
    props.error,
    renderedTick,
  ]);
  const rendered = (report: { nodes: number; triangles: number; drawCalls: number }) => {
    if (props.enabled && report.nodes > 0 && report.triangles > 0 && report.drawCalls > 0) {
      if (!previewRendered.current) {
        previewRendered.current = true;
        setRenderedTick((tick) => tick + 1);
      }
    }
  };
  return {
    phase,
    rendered,
    workspace: props.enabled
      ? phase === 'study' ||
        phase === 'mesh' ||
        phase === 'solve' ||
        phase === 'solved' ||
        phase === 'complete'
        ? 'analysis'
        : 'cad'
      : null,
  } as const;
}
