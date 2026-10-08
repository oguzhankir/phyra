import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import type { NumericalProject as Project } from '../contracts/types';
import { resultIsCurrent } from '../execution/presentation';
import type { ResultData } from '../results/fields';
import { changeStudyDimension } from './study';
import { createHistory, recordEdit, redo, undo, type HistoryChange } from './history';

function edit(
  state: HistoryChange,
  change: (project: Project) => void,
  physical = true,
): HistoryChange {
  const edited = structuredClone(state.project);
  change(edited);
  return recordEdit(state.history, state.project, edited, physical);
}
function initial(): HistoryChange {
  const project = makeProject('cantilever');
  return { project, history: createHistory(project), changed: false };
}

describe('definition edit history and result ownership', () => {
  it('never reactivates old fields when physical edits are undone and redone', () => {
    const start = initial();
    const data = {
      manifest: {
        projectId: start.project.id,
        studyId: start.project.study.id,
        revision: start.project.revision,
      },
    } as ResultData;
    expect(resultIsCurrent(start.project, data)).toBe(true);
    const changed = edit(start, (project) => (project.geometry.length *= 2));
    const reverted = undo(changed.history, changed.project);
    expect(reverted.project.geometry).toEqual(start.project.geometry);
    expect(reverted.project.revision).toBe(start.project.revision + 2);
    expect(resultIsCurrent(reverted.project, data)).toBe(false);
    const repeated = redo(reverted.history, reverted.project);
    expect(repeated.project.geometry).toEqual(changed.project.geometry);
    expect(repeated.project.revision).toBe(start.project.revision + 3);
    expect(resultIsCurrent(repeated.project, data)).toBe(false);
    expect(repeated.project.id).toBe(start.project.id);
    expect(repeated.project.study.id).toBe(start.project.study.id);
  });
  it('keeps current fields valid when only project display metadata changes', () => {
    const start = initial();
    const data = {
      manifest: {
        projectId: start.project.id,
        studyId: start.project.study.id,
        revision: start.project.revision,
      },
    } as ResultData;
    let state = edit(start, (project) => (project.displayUnits = 'm'), false);
    state = edit(state, (project) => (project.name = 'Reviewed beam'), false);
    expect(state.history.past.at(-1)?.label).toBe('Rename project');
    state = undo(state.history, state.project);
    state = undo(state.history, state.project);
    expect(state.project).toEqual(start.project);
    state = redo(state.history, state.project);
    state = redo(state.history, state.project);
    expect(state.project.name).toBe('Reviewed beam');
    expect(state.project.revision).toBe(start.project.revision);
    expect(resultIsCurrent(state.project, data)).toBe(true);
  });
  it('restores incompatible assignments atomically with a dimension edit', () => {
    const start = initial();
    const changed = edit(start, (project) => changeStudyDimension(project, '2d'));
    expect(changed.project.study.constraints).toEqual([]);
    expect(changed.project.study.loads).toEqual([]);
    const reverted = undo(changed.history, changed.project);
    expect(reverted.project.study.dimension).toBe('3d');
    expect(reverted.project.study.constraints).toEqual(start.project.study.constraints);
    expect(reverted.project.study.loads).toEqual(start.project.study.loads);
    expect(reverted.project.study.id).toBe(start.project.study.id);
    expect(reverted.project.revision).toBeGreaterThan(changed.project.revision);
  });
  it('preserves the current revision across metadata undo mixed with physical edits', () => {
    const start = initial();
    let state = edit(start, (project) => (project.geometry.length *= 2));
    state = edit(state, (project) => (project.name = 'Long beam'), false);
    state = edit(state, (project) => (project.study.material.young *= 2));
    state = undo(state.history, state.project);
    const revision = state.project.revision;
    state = undo(state.history, state.project);
    expect(state.project.revision).toBe(revision);
    expect(state.project.name).toBe(start.project.name);
    state = undo(state.history, state.project);
    expect(state.project.revision).toBe(revision + 1);
    expect(state.project.geometry).toEqual(start.project.geometry);
  });
  it('captures named selection metadata without invalidating scientific results', () => {
    const start = initial();
    const changed = edit(
      start,
      (project) => {
        project.namedSelections = [
          {
            id: crypto.randomUUID(),
            name: 'Loaded end',
            geometryKind: project.geometry.kind,
            dimension: project.study.dimension,
            regions: ['x1'],
          },
        ];
      },
      false,
    );
    expect(changed.history.past.at(-1)?.label).toBe('Edit named selections');
    expect(changed.project.revision).toBe(start.project.revision);
    const reverted = undo(changed.history, changed.project);
    expect(reverted.project.namedSelections).toEqual(start.project.namedSelections);
    const repeated = redo(reverted.history, reverted.project);
    expect(repeated.project.namedSelections).toEqual(changed.project.namedSelections);
    expect(repeated.project.revision).toBe(start.project.revision);
  });
});

describe('history snapshot isolation and replacement boundaries', () => {
  it('owns snapshots independently of input and returned project mutations', () => {
    const start = initial();
    const changed = edit(start, (project) => (project.study.loads[0].vector[1] = -123));
    start.project.geometry.length = 999;
    start.project.study.loads[0].vector[1] = -999;
    const current = structuredClone(changed.project);
    changed.project.study.material.young = 1;
    const reverted = undo(changed.history, current);
    expect(reverted.project.geometry.length).not.toBe(999);
    expect(reverted.project.study.loads[0].vector[1]).not.toBe(-999);
    const redoInput = structuredClone(reverted.project);
    reverted.project.study.loads[0].vector[1] = -777;
    const repeated = redo(reverted.history, redoInput);
    expect(repeated.project.study.loads[0].vector[1]).toBe(-123);
    expect(repeated.project.study.material.young).not.toBe(1);
  });
  it('does not put result buffers, weights or native file associations in snapshots', () => {
    const start = initial();
    Object.assign(start.project, {
      fields: new Float64Array([1, 2, 3]),
      weights: new Float32Array([4]),
      path: '/native-owned/project.phyra',
    });
    const changed = edit(start, (project) => (project.name = 'Renamed'), false);
    for (const value of [
      changed.project,
      changed.history.past[0].before,
      changed.history.past[0].after,
    ]) {
      expect(value).not.toHaveProperty('fields');
      expect(value).not.toHaveProperty('weights');
      expect(value).not.toHaveProperty('path');
    }
  });
  it('keeps a saved baseline outside history and intact after later edits', () => {
    const start = initial();
    const saved = structuredClone(start.project);
    const savedDefinition = JSON.stringify(saved);
    const changed = edit(start, (project) => (project.study.material.young *= 2));
    const reverted = undo(changed.history, changed.project);
    expect(saved).toEqual(start.project);
    expect(JSON.stringify(saved)).toBe(savedDefinition);
    expect(reverted.project.study.material).toEqual(saved.study.material);
    expect(reverted.project.revision).toBeGreaterThan(saved.revision);
    expect(reverted.history).not.toHaveProperty('path');
    expect(reverted.history).not.toHaveProperty('savedBaseline');
  });
  it.each(['new', 'open', 'reference', 'restore'])('resets the cursor on %s replacement', () => {
    const start = initial();
    const changed = edit(start, (project) => (project.geometry.length *= 2));
    const replacement = makeProject('plane-stress-tension');
    const history = createHistory(replacement);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
    expect(undo(history, replacement).changed).toBe(false);
    expect(() => undo(changed.history, replacement)).toThrow('Reset edit history');
  });
  it('rejects history attached to another study or an unrecorded replacement', () => {
    const start = initial();
    const changed = edit(start, (project) => (project.geometry.length *= 2));
    const otherStudy = structuredClone(changed.project);
    otherStudy.study.id = crypto.randomUUID();
    expect(() => undo(changed.history, otherStudy)).toThrow('Reset edit history');
    const externalChange = structuredClone(changed.project);
    externalChange.study.material.young *= 2;
    expect(() => undo(changed.history, externalChange)).toThrow('unrecorded project replacement');
  });
  it('rejects a rewound revision even when physical inputs match the cursor', () => {
    const start = initial();
    const changed = edit(start, (project) => (project.geometry.length *= 2));
    const rewound = { ...changed.project, revision: start.project.revision };
    expect(() => undo(changed.history, rewound)).toThrow('unrecorded revision change');
    expect(() => recordEdit(changed.history, rewound, rewound, false)).toThrow(
      'unrecorded revision change',
    );
    expect(changed.history.revision).toBe(changed.project.revision);
  });
  it('ignores caller revision and identity injection when determining a no-op', () => {
    const start = initial();
    const edited = structuredClone(start.project);
    edited.revision = 999;
    edited.id = 'replacement';
    edited.study.id = 'replacement-study';
    const state = recordEdit(start.history, start.project, edited, true);
    expect(state.changed).toBe(false);
    expect(state.history).toBe(start.history);
    expect(state.project).toEqual(start.project);
  });
  it('treats reordered object properties as the same definition', () => {
    const start = initial();
    const edited = structuredClone(start.project);
    edited.geometry = Object.fromEntries(
      Object.entries(edited.geometry).reverse(),
    ) as Project['geometry'];
    const state = recordEdit(start.history, start.project, edited, true);
    expect(state.changed).toBe(false);
    expect(state.history.past).toEqual([]);
  });
});

describe('bounded history and sequential editing', () => {
  it('ignores no-ops without clearing an existing redo branch', () => {
    const start = initial();
    const changed = edit(start, (project) => (project.geometry.length *= 2));
    const reverted = undo(changed.history, changed.project);
    const noOp = edit(reverted, () => {});
    expect(noOp.changed).toBe(false);
    expect(noOp.history).toBe(reverted.history);
    expect(redo(noOp.history, noOp.project).project.geometry).toEqual(changed.project.geometry);
  });
  it('replaces redo history only after a real branch edit', () => {
    const start = initial();
    let state = edit(start, (project) => (project.geometry.length *= 2));
    state = edit(state, (project) => (project.geometry.width *= 2));
    state = undo(state.history, state.project);
    state = edit(state, (project) => (project.study.material.young *= 2));
    expect(state.history.future).toEqual([]);
    expect(redo(state.history, state.project).changed).toBe(false);
    expect(state.project.geometry.width).toBe(start.project.geometry.width);
  });
  it('retains complete recent transactions rather than partial definitions at the step limit', () => {
    const start = initial();
    let state = { ...start, history: createHistory(start.project, { steps: 3, bytes: 1_000_000 }) };
    const originalLength = start.project.geometry.length;
    for (let index = 1; index <= 10; index++)
      state = edit(state, (project) => (project.geometry.length = originalLength + index));
    expect(state.history.past).toHaveLength(3);
    for (let index = 0; index < 3; index++) state = undo(state.history, state.project);
    expect(state.project.geometry.length).toBe(originalLength + 7);
    expect(undo(state.history, state.project).changed).toBe(false);
    for (let index = 0; index < 3; index++) state = redo(state.history, state.project);
    expect(state.project.geometry.length).toBe(originalLength + 10);
    expect(state.history.past).toHaveLength(3);
  });
  it('enforces serialized UTF-8 byte limits across both undo and redo stacks', () => {
    const start = initial();
    const measured = edit(start, (project) => (project.name = '温度'.repeat(30)), false);
    const firstBytes = measured.history.past[0].bytes;
    let state = {
      ...start,
      history: createHistory(start.project, { steps: 80, bytes: firstBytes * 2 }),
    };
    for (let index = 0; index < 8; index++)
      state = edit(state, (project) => (project.name = `温度${index}`.repeat(30)), false);
    const used = (value: HistoryChange) =>
      [...value.history.past, ...value.history.future].reduce((sum, entry) => sum + entry.bytes, 0);
    expect(used(state)).toBeLessThanOrEqual(firstBytes * 2);
    expect(state.history.past.length).toBeLessThan(8);
    const moved = undo(state.history, state.project);
    expect(used(moved)).toBe(used(state));
    expect(used(redo(moved.history, moved.project))).toBe(used(state));
  });
  it('preserves the edited project and clears inaccessible history if one transaction is oversized', () => {
    const start = initial();
    const state = { ...start, history: createHistory(start.project, { steps: 80, bytes: 1 }) };
    const changed = edit(state, (project) => (project.geometry.length *= 2));
    expect(changed.project.geometry.length).toBe(start.project.geometry.length * 2);
    expect(changed.project.revision).toBe(start.project.revision + 1);
    expect(changed.history.past).toEqual([]);
    expect(changed.history.future).toEqual([]);
    expect(changed.notice).toContain('current project is preserved');
    expect(undo(changed.history, changed.project).changed).toBe(false);
    expect(start.project.geometry.length).not.toBe(changed.project.geometry.length);
  });
  it('records rapid sequential transactions using each latest definition', () => {
    let state = initial();
    const original = state.project.geometry.length;
    const revision = state.project.revision;
    for (let index = 0; index < 40; index++)
      state = edit(state, (project) => (project.geometry.length += 0.001));
    expect(state.project.geometry.length).toBeCloseTo(original + 0.04, 12);
    expect(state.project.revision).toBe(revision + 40);
    for (let index = 0; index < 40; index++) state = undo(state.history, state.project);
    expect(state.project.geometry.length).toBe(original);
    expect(state.project.revision).toBe(revision + 80);
  });
  it('rejects revision exhaustion before changing history while allowing metadata edits', () => {
    const start = initial();
    start.project.revision = Number.MAX_SAFE_INTEGER;
    const state = { ...start, history: createHistory(start.project) };
    expect(() => edit(state, (project) => (project.geometry.length *= 2))).toThrow(
      'revision limit',
    );
    expect(state.history.past).toEqual([]);
    const metadata = edit(state, (project) => (project.name = 'Revision limit'), false);
    expect(metadata.project.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(undo(metadata.history, metadata.project).project.name).toBe(start.project.name);
  });
  it('rejects unbounded or invalid limits and malformed revisions', () => {
    const start = initial();
    expect(() => createHistory(start.project, { steps: 81, bytes: 1 })).toThrow('bounds');
    expect(() => createHistory(start.project, { steps: 1, bytes: Infinity })).toThrow('bounds');
    const invalid = { ...start.project, revision: NaN };
    expect(() => createHistory(invalid)).toThrow('integer range');
  });
});
