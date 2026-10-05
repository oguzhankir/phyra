import type { Manifest, Operation, Project } from '../domain/contracts/types';

export interface ExecutionLease {
  readonly generation: number;
  readonly requestId: string;
  readonly project: Project;
  readonly operation: Operation;
  cancelled: boolean;
  cancellation?: Promise<boolean>;
  jobId?: string;
}

// One owned native worker request. A late event, cancellation acknowledgement or
// result may mutate the UI only while this exact lease still owns execution.
export class ExecutionOwnership {
  private generation = 0;
  private active: ExecutionLease | null = null;

  begin(project: Project, operation: Operation): ExecutionLease {
    if (this.active) throw new Error('An execution already owns the native worker.');
    const lease = {
      generation: ++this.generation,
      requestId: crypto.randomUUID(),
      project,
      operation,
      cancelled: false,
    };
    this.active = lease;
    return lease;
  }

  event(requestId: string, jobId: string): ExecutionLease | null {
    const lease = this.active;
    if (
      !lease ||
      lease.cancelled ||
      lease.requestId !== requestId ||
      (lease.jobId && lease.jobId !== jobId)
    )
      return null;
    lease.jobId = jobId;
    return lease;
  }

  bind(lease: ExecutionLease, jobId: string): boolean {
    if (!this.owns(lease) || lease.cancelled || (lease.jobId && lease.jobId !== jobId))
      return false;
    lease.jobId = jobId;
    return true;
  }

  canPublish(lease: ExecutionLease, current: Project, manifest: Manifest): boolean {
    const snapshot = lease.project;
    return (
      this.owns(lease) &&
      !lease.cancelled &&
      lease.jobId === manifest.jobId &&
      lease.operation === manifest.operation &&
      current.id === snapshot.id &&
      current.study.id === snapshot.study.id &&
      current.revision === snapshot.revision &&
      manifest.projectId === snapshot.id &&
      manifest.studyId === snapshot.study.id &&
      manifest.revision === snapshot.revision
    );
  }

  cancel(): ExecutionLease | null {
    if (!this.active) return null;
    this.active.cancelled = true;
    return this.active;
  }

  activeLease(): ExecutionLease | null {
    return this.active;
  }

  requestCancellation(lease: ExecutionLease, stop: () => Promise<boolean>): Promise<boolean> {
    if (!this.owns(lease)) return Promise.resolve(false);
    if (lease.cancellation) return lease.cancellation;
    const attempt = (async () => {
      const stopped = await stop();
      if (stopped && this.owns(lease)) lease.cancelled = true;
      return stopped;
    })();
    lease.cancellation = attempt;
    void attempt.catch(() => {
      if (lease.cancellation === attempt) lease.cancellation = undefined;
    });
    return attempt;
  }

  async settleCancellation(lease: ExecutionLease): Promise<void> {
    while (lease.cancellation) {
      const pending = lease.cancellation;
      await pending.catch(() => undefined);
      if (lease.cancellation === pending) return;
    }
  }

  owns(lease: ExecutionLease): boolean {
    return this.active === lease;
  }

  finish(lease: ExecutionLease): boolean {
    if (!this.owns(lease)) return false;
    this.active = null;
    return true;
  }
}
