import type { CadSolidDomain, CadSolidProject, ProjectDefinition } from '../contracts/types';
import {
  validateCadMeshReceipt,
  validateCadMeshSource,
  type CadMeshReceipt,
} from '../geometry/cadMesh';
import { selectionNameKey } from './selectionNames';

/** Current accepted exact evidence; never serialized into the study definition. */
export interface CadSolidSource {
  projectId: string;
  geometryFingerprint: string;
  outputFeatureId: string;
  faces: {
    id: string;
    identity: 'content-reference' | 'ambiguous';
    name?: string;
    componentId?: string;
    componentPath?: string[];
  }[];
  bodies: { componentId?: string; componentPath?: string[] }[];
  statistics: { bodyCount: number; volume: number };
}

export function isCadSolidProject(project: ProjectDefinition): project is CadSolidProject {
  return project.geometry.kind === 'cad' && project.study?.domain?.kind === 'cad-solid';
}

/** Structural intent may be saved even when a later geometry edit requires repair. */
export function cadSolidDomainError(project: CadSolidProject): string | null {
  const { geometry, study } = project;
  const domain = study.domain;
  if (
    geometry.dimension !== '3d' ||
    study.dimension !== '3d' ||
    study.formulation !== 'solid' ||
    study.solver.kind !== 'fem'
  )
    return 'Exact CAD solid studies require 3D solid elasticity with FEM.';
  if (
    domain.kind !== 'cad-solid' ||
    typeof domain.geometryFingerprint !== 'string' ||
    domain.geometryFingerprint.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(domain.geometryFingerprint) ||
    typeof domain.outputFeatureId !== 'string' ||
    !selectionNameKey(domain.outputFeatureId) ||
    Array.from(domain.outputFeatureId).length > 100 ||
    !Array.isArray(domain.boundaries) ||
    domain.boundaries.length < 1 ||
    domain.boundaries.length > 512
  )
    return 'The CAD study boundary catalog is invalid or exceeds 512 faces.';
  const ids = new Set<string>(),
    faces = new Set<string>();
  const literalOwner =
    new TextEncoder().encode(domain.outputFeatureId).length <= 100
      ? `${domain.outputFeatureId}/face/`
      : null;
  for (const boundary of domain.boundaries) {
    if (
      !boundary ||
      typeof boundary.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(boundary.id) ||
      /[^A-Za-z0-9_-]/.test(boundary.id) ||
      ids.has(boundary.id) ||
      typeof boundary.faceId !== 'string' ||
      new TextEncoder().encode(boundary.faceId).length > 200 ||
      !/^.+\/face\/[a-f0-9]{24}$/u.test(boundary.faceId) ||
      (literalOwner !== null
        ? boundary.faceId.slice(0, -24) !== literalOwner
        : boundary.faceId.length !== 62 ||
          !/^feature-[a-f0-9]{24}\/face\/[a-f0-9]{24}$/u.test(boundary.faceId)) ||
      faces.has(boundary.faceId) ||
      typeof boundary.name !== 'string' ||
      !selectionNameKey(boundary.name) ||
      Array.from(boundary.name).length > 200
    )
      return 'Each CAD boundary needs a unique identifier, exact face reference and name.';
    ids.add(boundary.id);
    faces.add(boundary.faceId);
  }
  return null;
}

/** A stored catalog never proves that the current source geometry still owns its faces. */
export function cadSolidSourceError(
  project: CadSolidProject,
  source: CadSolidSource | null | undefined,
): string | null {
  const invalid = cadSolidDomainError(project);
  if (invalid) return invalid;
  if (!source) return 'Rebuild the exact CAD geometry to verify this study’s boundary assignments.';
  const domain = project.study.domain;
  if (
    source.projectId !== project.id ||
    source.geometryFingerprint !== domain.geometryFingerprint ||
    source.outputFeatureId !== domain.outputFeatureId ||
    project.geometry.outputFeatureId !== domain.outputFeatureId ||
    source.statistics.bodyCount !== 1 ||
    !Number.isFinite(source.statistics.volume) ||
    source.statistics.volume <= 0 ||
    source.bodies.length !== 1 ||
    [...source.bodies, ...source.faces].some(
      (entity) => entity.componentId !== undefined || entity.componentPath !== undefined,
    ) ||
    source.faces.length !== domain.boundaries.length ||
    new Set(source.faces.map((face) => face.id)).size !== source.faces.length ||
    source.faces.some((face) => face.identity !== 'content-reference') ||
    domain.boundaries.some((boundary) => !source.faces.some((face) => face.id === boundary.faceId))
  )
    return 'The CAD geometry changed. Review the current faces and explicitly repair the study’s boundary assignments.';
  return null;
}

/** Persist only the complete verified source catalog; no mesh rows or receipt ownership survive. */
export function cadSolidDomainFromMesh(
  receipt: CadMeshReceipt,
  source: CadSolidSource,
): CadSolidDomain {
  validateCadMeshReceipt(
    receipt,
    { id: source.projectId, revision: receipt.revision },
    receipt.targetSize,
  );
  validateCadMeshSource(receipt, source);
  if (
    receipt.correspondence.status !== 'verified' ||
    source.statistics.bodyCount !== 1 ||
    !Number.isFinite(source.statistics.volume) ||
    source.statistics.volume <= 0 ||
    source.bodies.length !== 1 ||
    [...source.bodies, ...source.faces].some(
      (entity) => entity.componentId !== undefined || entity.componentPath !== undefined,
    ) ||
    receipt.regions.length < 1 ||
    receipt.regions.length > 512 ||
    new Set(receipt.regions.map((region) => region.cadFaceId)).size !== receipt.regions.length ||
    receipt.regions.some(
      (region) =>
        typeof region.cadFaceId !== 'string' || !/^.+\/face\/[a-f0-9]{24}$/u.test(region.cadFaceId),
    )
  )
    throw new Error(
      'A CAD study requires complete correspondence for one closed solid with at most 512 faces.',
    );
  const names = new Map(source.faces.map((face) => [face.id, face.name]));
  const boundaries = receipt.regions.map((region) => ({
    id: `cad-${region.cadFaceId!.split('/face/').at(-1)!}`,
    faceId: region.cadFaceId!,
    name: names.get(region.cadFaceId!) || region.name,
  }));
  return {
    kind: 'cad-solid',
    geometryFingerprint: receipt.geometryFingerprint,
    outputFeatureId: receipt.outputFeatureId,
    boundaries: [boundaries[0], ...boundaries.slice(1)],
  };
}
