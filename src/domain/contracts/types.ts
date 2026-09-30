import type { EngineCapabilities } from './capabilities.generated';
export type { Project } from './project.generated.ts';
import type { Project } from './project.generated.ts';
export type Constraint = Project['study']['constraints'][number];
export type Load = Project['study']['loads'][number];
export type PinnConfiguration = Project['study']['solver']['pinn'];
export type Operation = 'mesh' | 'solve' | 'train' | 'compare';
export interface TrainingMetric {
  jobId: string;
  step: number;
  elapsed: number;
  total: number;
  pde: number;
  boundary: number;
  device: string;
}
export interface TrainingValidation {
  schemaVersion: 1;
  sampling: 'independent-uniform';
  seed: number;
  interiorPoints: number;
  boundaryPointsPerRegion: number;
  total: number;
  pde: number;
  boundary: number;
  displacement: number;
  traction: number;
}
export interface Devices {
  capabilities?: EngineCapabilities;
  devices: {
    id: string;
    label: string;
    available: boolean;
    precision: 'float64' | 'float32';
    reason: string;
  }[];
  defaultDevice: string;
  framework: string;
}
export interface ArrayDescriptor {
  offset: number;
  byteLength: number;
  dtype: 'float64' | 'uint32';
  shape: number[];
  association: 'node' | 'cell' | 'surface' | 'edge';
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
  operation: Operation;
  dimension?: '2d' | '3d';
  formulation?: 'plane-stress' | 'solid';
  cellType?: 'triangle3' | 'tetra4';
  thickness?: number;
  startedAt?: string;
  durationSeconds?: number;
  solver?: 'fem' | 'pinn' | 'comparison';
  device?: string;
  status: 'succeeded';
  byteLength: number;
  regions: { id: string; name: string; triangleCount: number; area: number }[];
  statistics: {
    nodes: number;
    cells: number;
    surfaceTriangles: number;
    boundaryEdges?: number;
    minQuality: number;
    qualityMetric: string;
  };
  training?: {
    configuration: PinnConfiguration;
    device: string;
    precision: 'float64' | 'float32';
    history: TrainingMetric[];
    timings: { trainingSeconds: number; inferenceSeconds: number };
    normalization: Record<string, number>;
    deviceReason?: string;
    framework?: string;
    residualDefinition?: string;
    validation?: TrainingValidation;
  };
  comparison?: {
    mapping: string;
    displacement: ComparisonMetric;
    stress: ComparisonMetric;
    vonMises: ComparisonMetric;
    femSeconds: number;
    trainingSeconds: number;
    inferenceSeconds: number;
    device: string;
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
  pinnSummary?: Manifest['summary'];
  warnings: string[];
  versions: Record<string, string>;
}
export interface ComparisonMetric {
  relativeL2: number | null;
  maxAbsolute: number;
  referenceNorm: number;
}
export interface Progress {
  type: 'progress';
  jobId: string;
  stage: string;
  progress: number | null;
}
