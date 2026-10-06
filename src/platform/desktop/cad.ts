import { invoke } from '@tauri-apps/api/core';
import type { ProjectDefinition, NativeAssetMetadata } from '../../domain/contracts/types';
import { recoveryOwnerId } from './recovery';
import { cadPreview } from '../../domain/geometry/cadPreview';

export type CadEntity = {
  id: string;
  name: string;
  identity: 'content-reference' | 'ambiguous';
  centroid: [number, number, number];
  bounds: [[number, number, number], [number, number, number]];
  area?: number;
  length?: number;
  volume?: number;
  surfaceType?: string;
  curveType?: string;
};
export type CadArray = {
  offset: number;
  byteLength: number;
  dtype: 'float64' | 'uint32';
  shape: number[];
  units: string;
  association: string;
};
export type CadReceipt = {
  protocolVersion: 1;
  operation: 'cad';
  status: 'succeeded';
  projectId: string;
  revision: number;
  jobId: string;
  geometryFingerprint: string;
  outputFeatureId: string;
  coordinateFrame: 'cartesian-global-SI';
  kernel: { name: string; version: string; binding: string; bindingVersion: string };
  byteLength: number;
  bufferHash: string;
  arrays: Record<
    'positions' | 'triangles' | 'triangleFaces' | 'edgePositions' | 'edgeSegments' | 'segmentEdges',
    CadArray
  >;
  faces: CadEntity[];
  edges: CadEntity[];
  bodies: CadEntity[];
  features: { id: string; kind: string; [key: string]: unknown }[];
  diagnostics: {
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    entityIds?: string[];
  }[];
  statistics: {
    bounds: [[number, number, number], [number, number, number]];
    surfaceArea: number;
    volume: number;
    faceCount: number;
    edgeCount: number;
    bodyCount: number;
    nodes: number;
    triangles: number;
    displayDeflection: number;
  };
  analysisCompatibility: {
    state: 'supported' | 'unsupported';
    dimension: '2d' | '3d';
    methodIds: string[];
    reason: string;
    numericalGeometry?: import('../../domain/contracts/types').NumericalGeometry;
    regionBindings?: { regionId: string; entityIds: string[] }[];
  };
};
export type CadDisplay = {
  positions: Float64Array;
  triangles: Uint32Array;
  triangleFaces: Uint32Array;
  edgePositions: Float64Array;
  edgeSegments: Uint32Array;
  segmentEdges: Uint32Array;
};

export async function evaluateCad(
  project: ProjectDefinition,
  requestId: string,
  documentId: string,
): Promise<CadReceipt> {
  const receipt = await invoke<CadReceipt>('evaluate_cad', {
    project,
    requestId,
    documentId,
    ownerId: recoveryOwnerId,
  });
  if (
    receipt.protocolVersion !== 1 ||
    receipt.operation !== 'cad' ||
    receipt.status !== 'succeeded' ||
    receipt.projectId !== project.id ||
    receipt.revision !== project.revision ||
    receipt.coordinateFrame !== 'cartesian-global-SI' ||
    !/^[a-f0-9]{64}$/.test(receipt.bufferHash) ||
    receipt.byteLength > 64 * 1024 * 1024 ||
    receipt.faces.length > 2048 ||
    receipt.edges.length > 2048 ||
    receipt.bodies.length > 2048
  ) {
    await finishCad(receipt.jobId, documentId, false);
    throw new Error('CAD receipt failed identity or resource validation.');
  }
  return receipt;
}
export async function readCadBuffer(jobId: string, documentId: string): Promise<ArrayBuffer> {
  const result = await invoke<ArrayBuffer | number[]>('read_cad_buffer', {
    jobId,
    documentId,
    ownerId: recoveryOwnerId,
  });
  return result instanceof ArrayBuffer ? result : new Uint8Array(result).buffer;
}
export async function decodeCadDisplay(
  receipt: CadReceipt,
  buffer: ArrayBuffer,
): Promise<CadDisplay> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (buffer.byteLength !== receipt.byteLength || hash !== receipt.bufferHash)
    throw new Error('CAD display integrity check failed.');
  return cadPreview(receipt, buffer);
}

export function finishCad(jobId: string, documentId: string, accept: boolean): Promise<void> {
  return invoke('finish_cad', { jobId, documentId, accept, ownerId: recoveryOwnerId });
}
export function cancelCad(requestId: string): Promise<boolean> {
  return invoke('cancel_cad', { requestId });
}
export function importCadSource(documentId: string): Promise<NativeAssetMetadata | null> {
  return invoke('import_cad_source', { documentId, ownerId: recoveryOwnerId });
}
export function exportCad(
  jobId: string,
  documentId: string,
  format: 'step' | 'brep',
  units: 'm' | 'mm',
): Promise<string | null> {
  return invoke('export_cad', { jobId, documentId, format, units, ownerId: recoveryOwnerId });
}
