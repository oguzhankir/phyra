import type { ProjectDefinition, CadGeometry } from '../../domain/contracts/types';
import type { SketchSolveReport } from '../../domain/geometry/sketchSolution';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import type { CadMeshPreview } from '../../domain/geometry/cadMesh';
import type { CadCommandModel } from './commandDraft';

export interface CadWorkspaceModel {
  project: ProjectDefinition;
  desktop: boolean;
  locked: boolean;
  nativeLocked: boolean;
  draftBlocked: boolean;
  dark: boolean;
  busy: boolean;
  cancellable: boolean;
  command: CadCommandModel;
  meshPreview?: CadMeshPreview | null;
  meshBusy?: boolean;
  inspectMesh?: (size: number) => Promise<boolean>;
  error: string | null;
  retainedPreview?: CadPreview | null;
  sketchSolve?: { featureId: string; report: SketchSolveReport } | null;
  solveSketch: (featureId: string) => Promise<void>;
  evaluation: {
    preview: CadPreview;
    kernel: string;
    analysisCompatibility: {
      state: 'supported' | 'unsupported';
      reason: string;
      methodIds: string[];
    };
    faceCount: number;
    edgeCount: number;
    bodyCount: number;
    volume: number;
    surfaceArea: number;
    sketches: {
      featureId: string;
      status: string;
      degreesOfFreedom: number | null;
      failedConstraintIds: string[];
    }[];
  } | null;
  editGeometry: (change: (geometry: CadGeometry) => void) => void;
  replaceGeometry: (geometry: ProjectDefinition['geometry']) => void;
  importSource: () => Promise<void>;
  evaluate: () => Promise<boolean>;
  cancel: () => Promise<void>;
  exportShape: (format: 'step' | 'brep', units: 'm' | 'mm') => Promise<void>;
  reportDraft: (id: string, label: string | null) => void;
  onError: (error: string | null) => void;
  onReturn: () => void;
  onHelp: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRendered?: (report: { nodes: number; triangles: number; drawCalls: number }) => void;
}
