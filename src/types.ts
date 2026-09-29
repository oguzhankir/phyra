export type { Project } from './project.generated';
import type { Project } from './project.generated';
export type Constraint = Project['study']['constraints'][number];
export type Load = Project['study']['loads'][number];
export interface ArrayDescriptor {
  offset: number;
  byteLength: number;
  dtype: 'float64' | 'uint32';
  shape: number[];
  association: 'node' | 'cell' | 'surface';
  units: string;
}
export interface Manifest {
  protocolVersion: 1;
  projectId: string;
  studyId: string;
  revision: number;
  fingerprint: string;
  jobId: string;
  meshId: string;
  bufferHash: string;
  coordinateFrame: string;
  stressComponents: string[];
  operation: 'mesh' | 'solve';
  status: 'succeeded';
  byteLength: number;
  regions: { id: string; name: string; triangleCount: number; area: number }[];
  statistics: {
    nodes: number;
    cells: number;
    surfaceTriangles: number;
    minQuality: number;
    qualityMetric: string;
  };
  arrays: Record<string, ArrayDescriptor>;
  summary?: {
    maxDisplacement: number;
    maxVonMises: number;
    strainEnergy: number;
    forceBalance: number[];
    momentBalance: number[];
    relativeResidual: number;
    relativeForceBalance: number;
    relativeMomentBalance: number;
    totalForce: number[];
    totalReaction: number[];
    elapsedSeconds: number;
  };
  warnings: string[];
  versions: Record<string, string>;
}
export interface Progress {
  type: 'progress';
  jobId: string;
  stage: string;
  progress: number | null;
}
