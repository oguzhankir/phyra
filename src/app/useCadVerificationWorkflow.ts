import { useEffect, useRef, useState, type RefObject } from 'react';
import { prepareStudy } from '../domain/project/readiness';
import { isCadSolidProject } from '../domain/project/cadSolid';
import type { Project, ProjectDefinition } from '../domain/contracts/types';
import type { ResultData } from '../domain/results/fields';
import { acceptsCadPreparationFrame } from './cadVerificationFrames';
import { invokeVerification, type CadPreparationRender } from '../platform/desktop/verification';
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
  | 'inspection-evaluated'
  | 'inspection-selected-model'
  | 'inspection-menu'
  | 'inspection-panel'
  | 'inspection-selected'
  | 'inspection-cad'
  | 'inspection-cleared'
  | 'inspection-closed'
  | 'restored'
  | 'restored-evaluated'
  | 'study'
  | 'mesh'
  | 'solve'
  | 'solved'
  | 'general-start'
  | 'general-evaluate'
  | 'general-evaluated'
  | 'general-inspected'
  | 'general-menu'
  | 'general-panel'
  | 'general-form'
  | 'general-form-ready'
  | 'general-prepared'
  | 'general-face-selected'
  | 'general-support-menu'
  | 'general-support'
  | 'general-load'
  | 'general-load-assigned'
  | 'general-source-stale'
  | 'general-source-restored'
  | 'general-mesh'
  | 'general-solve'
  | 'general-solved'
  | 'complete'
  | 'failed';
interface Props {
  enabled: boolean;
  documentId: string;
  ready: boolean;
  project: ProjectDefinition;
  projectRef: RefObject<ProjectDefinition>;
  analysisProject: Project | null;
  selected: string[];
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
  const scheduledPhase = useRef<Phase>('start');
  const [renderedTick, setRenderedTick] = useState(0);
  const pending = useRef(false),
    base = useRef<string | null>(null),
    previewRendered = useRef(false);
  const advancedIndex = useRef(0),
    advancedDefinitions = useRef<ProjectDefinition[]>([]);
  const advancedEvidence = useRef<Record<string, unknown>[]>([]);
  const rendererIds = useRef(new Set<string>());
  const inspectionFrames = useRef({ mesh: false, cad: false });
  const inspectionSource = useRef('');
  const generalGeometry = useRef<ProjectDefinition['geometry'] | null>(null);
  const preparationFrame = useRef<CadPreparationRender | null>(null);
  const generalLoadRegion = useRef('');
  const generalStudy = useRef('');
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
    rendererReused: false,
    meshGenerated: false,
    inspectionGenerated: false,
    inspectionPreservedCad: false,
    inspectionInvalidated: false,
    inspectionCorrespondence: false,
    inspectionUi: false,
    inspectionSelectionIsolated: false,
    generalPreparation: false,
    generalStaleSourceGate: false,
    generalAssignments: false,
    generalMesh: false,
    generalSolve: false,
  });
  const failed = async (message: string) => {
    scheduledPhase.current = 'failed';
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
      phase !== scheduledPhase.current ||
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
          if (rendererIds.current.size !== 1)
            throw new Error('CAD rebuilding recreated the viewport graphics context.');
          evidence.current.rendererReused = advancedIndex.current > 0;
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
          trace('retained exact buffer read started');
          const retainedBuffer = await readCadBuffer(receipt.jobId, p.documentId);
          trace('retained exact buffer read completed');
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
          const before = JSON.stringify(p.projectRef.current);
          const receipt = p.cad.current.receipt;
          if (!(await p.cad.inspectMesh(0.01)))
            throw new Error('Exact Boolean mesh inspection failed.');
          trace('inspection retained exact buffer read started');
          const buffer = await readCadBuffer(receipt.jobId, p.documentId);
          trace('inspection retained exact buffer read completed');
          evidence.current.inspectionPreservedCad =
            buffer.byteLength === receipt.byteLength &&
            JSON.stringify(p.projectRef.current) === before;
          if (!evidence.current.inspectionPreservedCad)
            throw new Error('Mesh inspection replaced exact CAD or changed the definition.');
          nextPhase = 'inspection-evaluated';
          break;
        }
        case 'inspection-evaluated': {
          if (!p.cad.meshPreview) {
            if (p.error) throw new Error(p.error);
            return;
          }
          const mesh = p.cad.meshPreview;
          evidence.current.inspectionGenerated =
            mesh.receipt.purpose === 'inspection-only' &&
            mesh.cells.length > 0 &&
            mesh.receipt.statistics.minQuality > 0 &&
            p.analysisProject === null;
          if (!evidence.current.inspectionGenerated)
            throw new Error('Inspection evidence was invalid or enabled unsupported analysis.');
          evidence.current.inspectionCorrespondence =
            mesh.receipt.correspondence.status === 'verified' &&
            mesh.receipt.regions.every((region) => !!region.cadFaceId);
          if (!evidence.current.inspectionCorrespondence)
            throw new Error('Exact CAD face correspondence was not established for the Boolean.');
          inspectionSource.current = JSON.stringify(p.projectRef.current);
          generalGeometry.current = structuredClone(p.projectRef.current.geometry);
          const summary = document.querySelector<HTMLElement>('.cad-entity-section summary');
          if (!summary) throw new Error('Model navigator did not expose geometry entities.');
          if (!summary.closest('details')?.open) summary.click();
          const face = document.querySelector<HTMLInputElement>(
            '.cad-entity-list input[type="checkbox"]',
          );
          if (!face) throw new Error('Authored CAD face selection was unavailable.');
          face.click();
          nextPhase = 'inspection-selected-model';
          break;
        }
        case 'inspection-selected-model': {
          if (!document.querySelector<HTMLInputElement>('.cad-entity-list input')?.checked)
            throw new Error('Authored face selection did not update through its control.');
          verificationButton(document, 'button[aria-label="Inspect"]').click();
          nextPhase = 'inspection-menu';
          break;
        }
        case 'inspection-menu': {
          const menu = document.querySelector('[role="menu"][aria-label="Inspect"]');
          const item = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
            (button) => button.textContent?.trim() === 'Mesh inspection',
          );
          if (!item || item.disabled)
            throw new Error('Inspect menu did not offer mesh inspection.');
          item.click();
          nextPhase = 'inspection-panel';
          break;
        }
        case 'inspection-panel': {
          if (!inspectionFrames.current.mesh) return;
          const panel = verificationInspectionPanel();
          verificationButton(panel, '[aria-label="Mesh boundaries"] button').click();
          nextPhase = 'inspection-selected';
          break;
        }
        case 'inspection-selected': {
          const panel = verificationInspectionPanel();
          if (
            verificationButton(panel, '[aria-label="Mesh boundaries"] button').getAttribute(
              'aria-pressed',
            ) !== 'true' ||
            !document.querySelector<HTMLSelectElement>('[aria-label="Model selection mode"]')
              ?.disabled
          )
            throw new Error('Mesh boundary selection did not stay scoped to inspection.');
          verificationButton(document, '[aria-label="Fit inspected face to view"]').click();
          const cad = Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find(
            (button) => button.textContent?.trim() === 'CAD faces',
          );
          if (!cad || cad.disabled) throw new Error('Matched CAD face view was unavailable.');
          cad.click();
          nextPhase = 'inspection-cad';
          break;
        }
        case 'inspection-cad': {
          if (!inspectionFrames.current.cad) return;
          const panel = verificationInspectionPanel();
          if (
            !Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).some(
              (button) =>
                button.textContent?.trim() === 'CAD faces' &&
                button.getAttribute('aria-pressed') === 'true',
            ) ||
            verificationButton(panel, '[aria-label="Mesh boundaries"] button').getAttribute(
              'aria-pressed',
            ) !== 'true'
          )
            throw new Error('CAD correspondence view did not retain its inspected face.');
          verificationButton(panel, '[aria-label="Clear inspected boundary"]').click();
          nextPhase = 'inspection-cleared';
          break;
        }
        case 'inspection-cleared': {
          const panel = verificationInspectionPanel();
          if (panel.querySelector('[aria-label="Mesh boundaries"] button[aria-pressed="true"]'))
            throw new Error('Clear inspected boundary did not clear the inspection.');
          verificationButton(panel, '[aria-label="Close mesh inspection"]').click();
          nextPhase = 'inspection-closed';
          break;
        }
        case 'inspection-closed': {
          evidence.current.inspectionUi =
            inspectionFrames.current.mesh &&
            inspectionFrames.current.cad &&
            !document.querySelector('aside[aria-label="Mesh inspection"]');
          evidence.current.inspectionSelectionIsolated =
            document.querySelector<HTMLInputElement>('.cad-entity-list input')?.checked === true &&
            inspectionSource.current === JSON.stringify(p.projectRef.current);
          if (!evidence.current.inspectionUi || !evidence.current.inspectionSelectionIsolated)
            throw new Error('Inspection changed authored face selection or project definitions.');
          trace(
            'actual inspection panel -> boundary selection -> rendered mesh/CAD -> clear/close',
          );
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
          evidence.current.inspectionInvalidated = p.cad.meshPreview === null;
          if (!evidence.current.inspectionInvalidated)
            throw new Error('Geometry edit retained a current mesh inspection.');
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
          nextPhase = 'general-start';
          break;
        case 'general-start':
          p.edit((next) => {
            if (!generalGeometry.current) throw new Error('General CAD recipe was not retained.');
            next.geometry = structuredClone(generalGeometry.current);
            next.study = null;
          });
          preparationFrame.current = null;
          inspectionFrames.current = { mesh: false, cad: false };
          nextPhase = 'general-evaluate';
          break;
        case 'general-evaluate':
          if (!(await p.cad.evaluate())) throw new Error('General solid exact rebuild failed.');
          nextPhase = 'general-evaluated';
          break;
        case 'general-evaluated':
          if (!p.cad.current) return;
          if (!(await p.cad.inspectMesh(0.01)))
            throw new Error('General solid correspondence failed.');
          nextPhase = 'general-inspected';
          break;
        case 'general-inspected':
          if (!p.cad.meshPreview) return;
          verificationButton(document, 'button[aria-label="Inspect"]').click();
          nextPhase = 'general-menu';
          break;
        case 'general-menu':
          verificationTextButton(
            document.querySelector('[role="menu"][aria-label="Inspect"]')!,
            'Mesh inspection',
          ).click();
          nextPhase = 'general-panel';
          break;
        case 'general-panel':
          if (!inspectionFrames.current.mesh) return;
          verificationTextButton(verificationInspectionPanel(), 'Prepare analysis').click();
          nextPhase = 'general-form';
          break;
        case 'general-form': {
          const form = document.querySelector<HTMLFormElement>('.overview-study-form');
          if (!form) throw new Error('Prepare analysis did not open the material dialog.');
          verificationInput(form, 'Material name', 'General CAD test material');
          verificationInput(form, 'Young’s modulus', '210000000000');
          verificationInput(form, 'Poisson’s ratio', '0.3');
          verificationInput(form, 'Target mesh size', '10');
          nextPhase = 'general-form-ready';
          break;
        }
        case 'general-form-ready':
          verificationTextButton(
            document.querySelector('.overview-study-form')!,
            'Create study',
          ).click();
          nextPhase = 'general-prepared';
          break;
        case 'general-prepared': {
          if (!isCadSolidProject(p.project) || !preparationFrame.current) return;
          if (JSON.stringify(p.project.geometry) !== JSON.stringify(generalGeometry.current))
            throw new Error('Preparing general CAD replaced its authored recipe.');
          const frame = preparationFrame.current;
          const canvas = document.querySelector<HTMLCanvasElement>('.model-viewport canvas');
          if (
            !canvas ||
            !frame.triangles ||
            !p.project.study.domain.boundaries.some((face) => face.id === frame.region)
          )
            throw new Error('General CAD preparation did not render a bound exact face.');
          canvas.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: frame.clientX,
              clientY: frame.clientY,
            }),
          );
          nextPhase = 'general-face-selected';
          break;
        }
        case 'general-face-selected':
          if (p.selected.length !== 1 || p.selected[0] !== preparationFrame.current?.region)
            throw new Error('Context picking did not select the exact CAD catalog boundary.');
          evidence.current.generalPreparation = true;
          nextPhase = 'general-support-menu';
          break;
        case 'general-support-menu':
          verificationTextButton(document, 'Add support to selection…').click();
          nextPhase = 'general-support';
          break;
        case 'general-support': {
          if (
            !isCadSolidProject(p.project) ||
            p.project.study.constraints.length !== 1 ||
            p.project.study.constraints[0].regions[0] !== preparationFrame.current?.region
          )
            throw new Error('Selected exact face was not assigned to the support.');
          const support = p.project.study.domain.boundaries.find(
            (face) => face.id === preparationFrame.current?.region,
          )!;
          const supportFace = p.cad.current!.receipt.faces.find(
            (face) => face.id === support.faceId,
          )!;
          const candidates = p.cad.current!.receipt.faces.filter(
            (face) => face.id !== support.faceId,
          );
          candidates.sort(
            (a, b) =>
              Math.hypot(...b.centroid.map((value, i) => value - supportFace.centroid[i])) -
              Math.hypot(...a.centroid.map((value, i) => value - supportFace.centroid[i])),
          );
          generalLoadRegion.current = p.project.study.domain.boundaries.find(
            (face) => face.faceId === candidates[0].id,
          )!.id;
          verificationButton(document, '.model-browser [aria-label="Add load"]').click();
          nextPhase = 'general-load';
          break;
        }
        case 'general-load': {
          const load = p.project.study?.loads[0];
          if (!load) return;
          const label = Array.from(
            document.querySelectorAll<HTMLLabelElement>('.model-panel .boundary-list label'),
          ).find((item) => item.querySelector('code')?.textContent === generalLoadRegion.current);
          if (!label) throw new Error('Bound CAD face was absent from the load assignment list.');
          if (!load.regions.includes(generalLoadRegion.current))
            label.querySelector<HTMLInputElement>('input')!.click();
          nextPhase = 'general-load-assigned';
          break;
        }
        case 'general-load-assigned': {
          const load = p.project.study?.loads[0];
          if (!load) throw new Error('General CAD load disappeared.');
          for (const region of load.regions.filter((id) => id !== generalLoadRegion.current)) {
            const label = Array.from(
              document.querySelectorAll<HTMLLabelElement>('.model-panel .boundary-list label'),
            ).find((item) => item.querySelector('code')?.textContent === region);
            if (!label) throw new Error('Assigned boundary control disappeared.');
            label.querySelector<HTMLInputElement>('input')!.click();
          }
          verificationInput(document.querySelector('.model-panel')!, 'Force X', '1000');
          verificationInput(document.querySelector('.model-panel')!, 'Force Y', '0');
          verificationInput(document.querySelector('.model-panel')!, 'Force Z', '0');
          nextPhase = 'general-mesh';
          break;
        }
        case 'general-mesh':
          generalStudy.current = JSON.stringify(p.project.study);
          p.edit((next) => {
            if (next.geometry.kind !== 'cad' || next.geometry.features[0].kind !== 'box')
              throw new Error('Verification source is no longer a box Boolean.');
            next.geometry.features[0].length *= 1.1;
          });
          nextPhase = 'general-source-stale';
          break;
        case 'general-source-stale': {
          if (!isCadSolidProject(p.project))
            throw new Error('CAD source edit discarded its study.');
          const readiness = prepareStudy(p.project, 0, p.cad.current?.receipt);
          if (
            p.cad.current ||
            readiness.canMesh ||
            readiness.canRun ||
            JSON.stringify(p.project.study) !== generalStudy.current
          )
            throw new Error(
              'CAD source edit lost assignments or bypassed the current-source gate.',
            );
          p.undo();
          nextPhase = 'general-source-restored';
          break;
        }
        case 'general-source-restored':
          evidence.current.generalAssignments =
            isCadSolidProject(p.project) &&
            p.project.study.loads[0]?.regions.length === 1 &&
            p.project.study.loads[0].regions[0] === generalLoadRegion.current &&
            p.project.study.loads[0].vector[0] === 1000;
          if (!evidence.current.generalAssignments)
            throw new Error('CAD load controls did not persist their face and force.');
          evidence.current.generalStaleSourceGate =
            !!p.cad.current &&
            JSON.stringify(p.project.study) === generalStudy.current &&
            JSON.stringify(p.project.geometry) === JSON.stringify(generalGeometry.current);
          if (!evidence.current.generalStaleSourceGate)
            throw new Error('Undo failed to restore the authored CAD study and its face catalog.');
          await p.execute('mesh');
          nextPhase = 'general-solve';
          break;
        case 'general-solve':
          if (!p.currentData || p.currentData.manifest.operation !== 'mesh') {
            if (p.error) throw new Error(p.error);
            return;
          }
          evidence.current.generalMesh = true;
          await p.execute('solve');
          nextPhase = 'general-solved';
          break;
        case 'general-solved':
          if (!p.currentData || p.currentData.manifest.operation !== 'solve') {
            if (p.error) throw new Error(p.error);
            return;
          }
          evidence.current.generalSolve = true;
          if (!isCadSolidProject(p.project) || !p.cad.current)
            throw new Error('General study source was lost.');
          {
            const receipt = p.cad.current.receipt;
            const end = receipt.faces.filter(
              (face) =>
                Math.abs(face.centroid[0] - receipt.statistics.bounds[1][0]) < 1e-10 &&
                Math.abs(face.bounds[1][0] - face.bounds[0][0]) < 1e-10,
            );
            if (end.length !== 1)
              throw new Error('Independent X-positive face reference is ambiguous.');
            const expectedPickedRegion = p.project.study.domain.boundaries.find(
              (face) => face.faceId === end[0].id,
            )?.id;
            p.report.current = {
              ...evidence.current,
              expectedPickedRegion,
              advanced: advancedEvidence.current,
              advancedDefinitions: advancedDefinitions.current,
              jobId: receipt.jobId,
              exportIntegrity: false,
            };
          }
          trace(
            'general CAD -> actual preparation dialog -> exact face context pick -> support/load controls -> mesh/solve',
          );
          nextPhase = 'complete';
          break;
      }
    })()
      .catch((error) => {
        nextPhase = null;
        return failed(String(error));
      })
      .finally(() => {
        // Edits/render callbacks can enqueue an effect with the previous phase.
        // Revoke that phase before unlocking, even before React commits setPhase.
        if (nextPhase) scheduledPhase.current = nextPhase;
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
  const rendered = (report: {
    nodes: number;
    triangles: number;
    drawCalls: number;
    rendererId?: string;
    inspectionView?: 'mesh' | 'cad';
  }) => {
    if (props.enabled && report.nodes > 0 && report.triangles > 0 && report.drawCalls > 0) {
      if (report.inspectionView) {
        if (!inspectionFrames.current[report.inspectionView]) {
          inspectionFrames.current[report.inspectionView] = true;
          setRenderedTick((tick) => tick + 1);
        }
        return;
      }
      if (report.rendererId) rendererIds.current.add(report.rendererId);
      if (!previewRendered.current) {
        previewRendered.current = true;
        setRenderedTick((tick) => tick + 1);
      }
    }
  };
  return {
    phase,
    rendered,
    preparationRendered: (report: CadPreparationRender) => {
      // Dialog submission can mount the analysis view before React commits the next
      // verification phase. Own the first frame by the explicit CAD study, not effect order.
      if (
        props.enabled &&
        !preparationFrame.current &&
        acceptsCadPreparationFrame(
          current.current.projectRef.current,
          generalGeometry.current,
          report,
        )
      ) {
        preparationFrame.current = report;
        setRenderedTick((tick) => tick + 1);
      }
    },
    workspace: props.enabled
      ? [
          'general-prepared',
          'general-face-selected',
          'general-support-menu',
          'general-support',
          'general-load',
          'general-load-assigned',
          'general-mesh',
          'general-source-stale',
          'general-source-restored',
          'general-solve',
          'general-solved',
        ].includes(phase) ||
        phase === 'study' ||
        phase === 'mesh' ||
        phase === 'solve' ||
        phase === 'solved' ||
        phase === 'complete'
        ? 'analysis'
        : 'cad'
      : null,
  } as const;
}

function verificationButton(root: ParentNode, selector: string) {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button || button.disabled) throw new Error(`Verification control unavailable: ${selector}`);
  return button;
}

function verificationInspectionPanel() {
  const panel = document.querySelector<HTMLElement>('aside[aria-label="Mesh inspection"]');
  if (!panel) throw new Error('Mesh inspection panel did not open.');
  return panel;
}

function verificationTextButton(root: ParentNode, text: string) {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button || button.disabled) throw new Error(`Verification action unavailable: ${text}`);
  return button;
}
function verificationInput(root: ParentNode, label: string, value: string) {
  const element = Array.from(root.querySelectorAll<HTMLLabelElement>('label'))
    .find((item) => item.textContent?.trim().startsWith(label))
    ?.querySelector<HTMLInputElement>('input');
  if (!element || element.disabled) throw new Error(`Verification input unavailable: ${label}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
