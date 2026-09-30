import schema from '../../../contracts/project.schema.json';
import type { Project } from '../contracts/types';

const MAX_STEPS = 80;
const MAX_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const definitionKeys = Object.keys(schema.properties) as (keyof Project)[];

export interface HistoryLimits {
  readonly steps: number;
  readonly bytes: number;
}
export interface HistoryEntry {
  readonly before: Project;
  readonly after: Project;
  readonly physical: boolean;
  readonly label: string;
  readonly bytes: number;
}
export interface EditHistory {
  readonly projectId: string;
  readonly studyId: string;
  readonly revision: number;
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  readonly limits: HistoryLimits;
}
export interface HistoryChange {
  readonly history: EditHistory;
  readonly project: Project;
  readonly changed: boolean;
  readonly notice?: string;
}

// The canonical definition is the only history payload. Workspace fields, trained weights,
// native file associations and selection state are deliberately outside this boundary.
function snapshot(project: Project): Project {
  return structuredClone(
    Object.fromEntries(definitionKeys.map((key) => [key, project[key]])),
  ) as unknown as Project;
}
function definitionKey(project: Project): string {
  const definition = snapshot(project);
  definition.revision = 0;
  return JSON.stringify(definition, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
}
function assertIdentity(history: EditHistory, project: Project): void {
  if (history.projectId !== project.id || history.studyId !== project.study.id)
    throw new Error('Reset edit history before replacing a project or study.');
  if (!Number.isSafeInteger(project.revision) || project.revision < 0)
    throw new Error('Project revision is outside the supported integer range.');
}
function assertCursor(history: EditHistory, project: Project): void {
  assertIdentity(history, project);
  if (history.revision !== project.revision)
    throw new Error('Reset edit history before applying an unrecorded revision change.');
  const expected = history.past.at(-1)?.after ?? history.future.at(-1)?.before;
  if (expected && definitionKey(expected) !== definitionKey(project))
    throw new Error('Reset edit history before applying an unrecorded project replacement.');
}
function nextRevision(current: Project, physical: boolean): number {
  if (physical && current.revision === Number.MAX_SAFE_INTEGER)
    throw new Error('Project revision limit reached. Start a new project before editing.');
  return current.revision + (physical ? 1 : 0);
}
function describeEdit(before: Project, after: Project): string {
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if (changed(before.geometry, after.geometry)) return 'Edit geometry';
  if (before.study.dimension !== after.study.dimension) return 'Change study dimension';
  if (changed(before.study.material, after.study.material)) return 'Edit material';
  if (changed(before.study.mesh, after.study.mesh)) return 'Edit mesh';
  if (changed(before.study.constraints, after.study.constraints)) return 'Edit supports';
  if (changed(before.study.loads, after.study.loads)) return 'Edit loads';
  if (before.study.thickness !== after.study.thickness) return 'Edit thickness';
  if (changed(before.study.solver, after.study.solver))
    return before.study.solver.kind !== after.study.solver.kind
      ? 'Change solution method'
      : 'Edit training configuration';
  if (changed(before.namedSelections, after.namedSelections)) return 'Edit named selections';
  if (before.name !== after.name) return 'Rename project';
  if (before.displayUnits !== after.displayUnits) return 'Change display units';
  return 'Edit project';
}

export function createHistory(
  project: Project,
  limits: HistoryLimits = { steps: MAX_STEPS, bytes: MAX_BYTES },
): EditHistory {
  if (
    !Number.isSafeInteger(limits.steps) ||
    limits.steps < 1 ||
    limits.steps > MAX_STEPS ||
    !Number.isSafeInteger(limits.bytes) ||
    limits.bytes < 1 ||
    limits.bytes > MAX_BYTES
  )
    throw new Error('Edit history limits exceed the supported bounds.');
  const history: EditHistory = {
    projectId: project.id,
    studyId: project.study.id,
    revision: project.revision,
    past: [],
    future: [],
    limits: { ...limits },
  };
  assertIdentity(history, project);
  return history;
}

export function recordEdit(
  history: EditHistory,
  before: Project,
  edited: Project,
  physical: boolean,
  label?: string,
): HistoryChange {
  assertCursor(history, before);
  const after = snapshot(edited);
  after.id = before.id;
  after.study.id = before.study.id;
  after.revision = before.revision;
  if (definitionKey(before) === definitionKey(after))
    return { history, project: snapshot(before), changed: false };
  after.revision = nextRevision(before, physical);
  const ownedBefore = snapshot(before);
  const description = label?.trim().slice(0, 80) || describeEdit(before, after);
  const bytes = encoder.encode(JSON.stringify([ownedBefore, after, description])).byteLength;
  if (bytes > history.limits.bytes)
    return {
      history: createHistory(after, history.limits),
      project: after,
      changed: true,
      notice:
        'Undo history was reset because this edit exceeds the memory limit. The current project is preserved.',
    };
  const entry: HistoryEntry = {
    before: ownedBefore,
    after: snapshot(after),
    physical,
    label: description,
    bytes,
  };
  const past = [...history.past, entry];
  let retainedBytes = past.reduce((sum, item) => sum + item.bytes, 0);
  while (past.length > history.limits.steps || retainedBytes > history.limits.bytes)
    retainedBytes -= past.shift()!.bytes;
  return {
    history: { ...history, revision: after.revision, past, future: [] },
    project: after,
    changed: true,
  };
}

export function undo(history: EditHistory, current: Project): HistoryChange {
  assertCursor(history, current);
  const entry = history.past.at(-1);
  if (!entry) return { history, project: snapshot(current), changed: false };
  const project = snapshot(entry.before);
  project.revision = nextRevision(current, entry.physical);
  return {
    history: {
      ...history,
      revision: project.revision,
      past: history.past.slice(0, -1),
      future: [...history.future, entry],
    },
    project,
    changed: true,
  };
}

export function redo(history: EditHistory, current: Project): HistoryChange {
  assertCursor(history, current);
  const entry = history.future.at(-1);
  if (!entry) return { history, project: snapshot(current), changed: false };
  const project = snapshot(entry.after);
  project.revision = nextRevision(current, entry.physical);
  return {
    history: {
      ...history,
      revision: project.revision,
      past: [...history.past, entry],
      future: history.future.slice(0, -1),
    },
    project,
    changed: true,
  };
}
