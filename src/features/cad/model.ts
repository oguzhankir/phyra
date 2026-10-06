import type { ProjectDefinition, CadGeometry } from '../../domain/contracts/types';
import type { CadPreview } from '../../domain/geometry/cadPreview';

export interface CadWorkspaceModel {
  project: ProjectDefinition;
  desktop: boolean;
  locked: boolean;
  nativeLocked: boolean;
  draftBlocked: boolean;
  dark: boolean;
  busy: boolean;
  error: string | null;
  evaluation: {
    preview: CadPreview;
    kernel: string;
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
  onSaveProject: () => Promise<boolean>;
  canSave: boolean;
}
