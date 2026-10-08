import type { CadGeometry, ProjectDefinition } from '../../domain/contracts/types';
import type { CadPreview } from '../../domain/geometry/cadPreview';

/** Display evidence only: a draft never owns a native receipt or analysis admission. */
export interface CadCommandPreview {
  preview: CadPreview;
  kernel: string;
  faceCount: number;
  edgeCount: number;
  bodyCount: number;
  volume: number;
  surfaceArea: number;
}

export interface CadCommandDraft {
  readonly id: string;
  readonly markerId: string;
  readonly version: number;
  readonly featureId: string;
  readonly label: string;
  readonly geometry: CadGeometry;
  readonly status: 'editing' | 'previewing' | 'ready' | 'failed';
  readonly preview: CadCommandPreview | null;
  readonly error: string | null;
}

export interface CadCommandRequest {
  readonly commandId: string;
  readonly version: number;
  readonly geometry: CadGeometry;
}

export interface CadCommandModel {
  draft: CadCommandDraft | null;
  inputBlocked: boolean;
  reportInputDraft: (id: string, label: string | null) => void;
  start: (geometry: CadGeometry, featureId: string, label: string) => boolean;
  update: (change: (geometry: CadGeometry) => void) => void;
  preview: () => Promise<boolean>;
  apply: () => boolean;
  cancel: () => Promise<void>;
}

/** Owns one transient command against an unchanged authored document. */
export class CadCommandOwnership {
  private active: CadCommandDraft | null = null;
  private base: { projectId: string; revision: number; geometry: string } | null = null;
  private pending: CadCommandRequest | null = null;

  current(): CadCommandDraft | null {
    return this.active;
  }

  begin(project: ProjectDefinition, geometry: CadGeometry, featureId: string, label: string) {
    if (this.active) return false;
    if (!geometry.features.some((feature) => feature.id === featureId)) return false;
    const id = crypto.randomUUID();
    this.base = {
      projectId: project.id,
      revision: project.revision,
      geometry: JSON.stringify(project.geometry),
    };
    this.active = {
      id,
      markerId: `cad-command:${id}`,
      version: 0,
      featureId,
      label,
      geometry: structuredClone(geometry),
      status: 'editing',
      preview: null,
      error: null,
    };
    return true;
  }

  matches(project: ProjectDefinition): boolean {
    return !!(
      this.active &&
      this.base?.projectId === project.id &&
      this.base.revision === project.revision &&
      this.base.geometry === JSON.stringify(project.geometry)
    );
  }

  update(change: (geometry: CadGeometry) => void): boolean {
    if (!this.active || this.active.status === 'previewing') return false;
    const geometry = structuredClone(this.active.geometry);
    change(geometry);
    if (JSON.stringify(geometry) === JSON.stringify(this.active.geometry)) return false;
    this.active = {
      ...this.active,
      version: this.active.version + 1,
      geometry,
      status: 'editing',
      preview: null,
      error: null,
    };
    return true;
  }

  request(project: ProjectDefinition): CadCommandRequest | null {
    if (!this.active || !this.matches(project) || this.active.status === 'previewing') return null;
    this.active = { ...this.active, status: 'previewing', preview: null, error: null };
    this.pending = {
      commandId: this.active.id,
      version: this.active.version,
      geometry: structuredClone(this.active.geometry),
    };
    return this.pending;
  }

  owns(request: CadCommandRequest, project: ProjectDefinition): boolean {
    return (
      this.matches(project) &&
      this.pending === request &&
      this.active?.id === request.commandId &&
      this.active.version === request.version &&
      this.active.status === 'previewing' &&
      JSON.stringify(this.active.geometry) === JSON.stringify(request.geometry)
    );
  }

  complete(
    request: CadCommandRequest,
    project: ProjectDefinition,
    preview: CadCommandPreview | null,
    error: string | null = null,
  ): boolean {
    if (!this.active || !this.owns(request, project)) return false;
    this.pending = null;
    this.active = {
      ...this.active,
      status: preview ? 'ready' : 'failed',
      preview,
      error: preview
        ? null
        : (error ?? 'Preview could not complete. Review the command and retry.'),
    };
    return true;
  }

  candidate(project: ProjectDefinition): CadGeometry | null {
    return this.active?.status === 'ready' && this.active.preview && this.matches(project)
      ? structuredClone(this.active.geometry)
      : null;
  }

  clear(): string | null {
    const marker = this.active?.markerId ?? null;
    this.active = null;
    this.base = null;
    this.pending = null;
    return marker;
  }
}
