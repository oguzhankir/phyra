import { describe, expect, it } from 'vitest';
import type { CadGeometry } from '../../domain/contracts/types';
import { makeProject } from '../examples/projects';
import { CadCommandOwnership, type CadCommandPreview } from './commandDraft';

function fixture() {
  const project = makeProject('cantilever');
  const geometry: CadGeometry = {
    kind: 'cad',
    dimension: '3d',
    features: [{ id: 'box', name: 'Box', kind: 'box', length: 0.1, width: 0.05, height: 0.02 }],
    outputFeatureId: 'box',
    assets: [],
  };
  const preview: CadCommandPreview = {
    preview: {
      positions: new Float64Array(),
      triangles: new Uint32Array(),
      triangleFaces: new Uint32Array(),
      edgePositions: new Float64Array(),
      edgeSegments: new Uint32Array(),
      segmentEdges: new Uint32Array(),
      faces: [],
      edges: [],
      bodies: [],
    },
    kernel: 'Test kernel',
    faceCount: 6,
    edgeCount: 12,
    bodyCount: 1,
    volume: 0.0001,
    surfaceArea: 0.016,
  };
  const commands = new CadCommandOwnership();
  expect(commands.begin(project, geometry, 'box', 'Create box')).toBe(true);
  return { project, geometry, preview, commands };
}

describe('transient CAD command ownership', () => {
  it('keeps creation and edits outside the authored project and caller geometry', () => {
    const { project, geometry, commands } = fixture();
    const original = structuredClone(project);
    commands.update((draft) => {
      const feature = draft.features[0];
      if (feature.kind === 'box') feature.length = 0.3;
    });
    expect(project).toEqual(original);
    expect(geometry.features[0]).toMatchObject({ length: 0.1 });
    expect(commands.current()?.geometry.features[0]).toMatchObject({ length: 0.3 });
    expect(commands.candidate(project)).toBeNull();
    expect(commands.begin(project, geometry, 'box', 'Replace draft')).toBe(false);
    expect(commands.current()?.label).toBe('Create box');
  });

  it('allows Apply only after the same draft completed preview', () => {
    const { project, commands, preview } = fixture();
    const ticket = commands.request(project)!;
    expect(commands.candidate(project)).toBeNull();
    expect(commands.current()?.status).toBe('previewing');
    expect(
      commands.update((draft) => {
        draft.features[0].name = 'Changed';
      }),
    ).toBe(false);
    expect(commands.complete(ticket, project, preview)).toBe(true);
    expect(commands.current()?.status).toBe('ready');
    const candidate = commands.candidate(project)!;
    candidate.features[0].name = 'Mutated returned candidate';
    expect(commands.current()?.geometry.features[0].name).toBe('Box');
    expect(
      commands.update((draft) => {
        draft.features[0].name = 'Revised box';
      }),
    ).toBe(true);
    expect(commands.candidate(project)).toBeNull();
    expect(commands.current()?.preview).toBeNull();
    expect(commands.complete(ticket, project, preview)).toBe(false);
  });

  it.each(['project', 'revision', 'geometry'] as const)(
    'rejects preview and Apply when the base %s changes',
    (change) => {
      const { project, commands, preview } = fixture();
      const ticket = commands.request(project)!;
      const changed = structuredClone(project);
      if (change === 'project') changed.id = 'another-document-project';
      if (change === 'revision') changed.revision++;
      if (change === 'geometry') changed.geometry.length *= 2;
      expect(commands.matches(changed)).toBe(false);
      expect(commands.complete(ticket, changed, preview)).toBe(false);
      expect(commands.candidate(changed)).toBeNull();
      expect(commands.request(changed)).toBeNull();
    },
  );

  it('revokes a late preview after Cancel without changing the authored revision', () => {
    const { project, geometry, commands, preview } = fixture();
    const original = structuredClone(project);
    const first = commands.request(project)!;
    const marker = commands.current()!.markerId;
    expect(commands.clear()).toBe(marker);
    expect(commands.complete(first, project, preview)).toBe(false);
    expect(commands.candidate(project)).toBeNull();
    expect(commands.current()).toBeNull();
    expect(project).toEqual(original);
    expect(commands.begin(project, geometry, 'box', 'New command')).toBe(true);
    const second = commands.request(project)!;
    expect(second.commandId).not.toBe(first.commandId);
    expect(commands.complete(first, project, preview)).toBe(false);
    expect(commands.complete(second, project, preview)).toBe(true);
  });

  it('keeps failed previews editable and permits a fresh successful retry', () => {
    const { project, commands, preview } = fixture();
    const first = commands.request(project)!;
    expect(commands.complete(first, project, null, 'The feature intersects itself.')).toBe(true);
    expect(commands.current()).toMatchObject({
      status: 'failed',
      error: 'The feature intersects itself.',
    });
    expect(commands.candidate(project)).toBeNull();
    const second = commands.request(project)!;
    expect(commands.complete(first, project, preview)).toBe(false);
    expect(commands.complete(second, project, preview)).toBe(true);
    expect(commands.current()?.error).toBeNull();
  });

  it('does not invalidate an exact preview for a no-op property edit', () => {
    const { project, commands, preview } = fixture();
    const ticket = commands.request(project)!;
    commands.complete(ticket, project, preview);
    expect(commands.update(() => {})).toBe(false);
    expect(commands.candidate(project)).not.toBeNull();
  });

  it('rejects a ticket whose candidate geometry was changed after request creation', () => {
    const { project, commands, preview } = fixture();
    const ticket = commands.request(project)!;
    ticket.geometry.features[0].name = 'Unrequested geometry';
    expect(commands.complete(ticket, project, preview)).toBe(false);
    expect(commands.candidate(project)).toBeNull();
  });
});
