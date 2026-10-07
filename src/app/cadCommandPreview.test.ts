import { describe, expect, it, vi } from 'vitest';
import { makeProject } from '../features/examples/projects';
import type { CadDisplay, CadReceipt } from '../platform/desktop/cad';
import { previewCadCommand } from './cadCommandPreview';

function fixture() {
  const project = makeProject('cantilever');
  const receipt = {
    projectId: project.id,
    revision: project.revision,
    jobId: 'pending-draft',
    kernel: { name: 'Exact test kernel', version: '1' },
    faces: [],
    edges: [],
    bodies: [],
    statistics: { faceCount: 6, edgeCount: 12, bodyCount: 1, volume: 0.0001, surfaceArea: 0.016 },
    analysisCompatibility: { state: 'supported', methodIds: ['fem-solid-tetra4'] },
  } as unknown as CadReceipt;
  const display: CadDisplay = {
    positions: new Float64Array(),
    triangles: new Uint32Array(),
    triangleFaces: new Uint32Array(),
    edgePositions: new Float64Array(),
    edgeSegments: new Uint32Array(),
    segmentEdges: new Uint32Array(),
  };
  const bridge = {
    evaluate: vi.fn(async () => receipt),
    read: vi.fn(async () => new ArrayBuffer(0)),
    decode: vi.fn(async () => display),
    finish: vi.fn(async () => {}),
  };
  return { project, bridge };
}

describe('CAD command preview publication', () => {
  it('traces each awaited preview boundary without changing discard-before-publication ordering', async () => {
    const { project, bridge } = fixture();
    const stages: string[] = [];
    await previewCadCommand(
      project,
      'request',
      'document',
      () => true,
      bridge,
      (stage) => stages.push(stage),
    );
    expect(stages).toEqual([
      'evaluate-start',
      'evaluate-received',
      'read-start',
      'read-received',
      'decode-start',
      'decode-complete',
      'discard-start',
      'discard-complete',
    ]);
    expect(bridge.finish).toHaveBeenCalledExactlyOnceWith('pending-draft', 'document', false);
  });
  it('discards native staging and publishes display only, never an export or analysis receipt', async () => {
    const { project, bridge } = fixture();
    const preview = await previewCadCommand(project, 'request', 'document', () => true, bridge);
    expect(bridge.finish).toHaveBeenCalledExactlyOnceWith('pending-draft', 'document', false);
    expect(preview).toMatchObject({ kernel: 'Exact test kernel 1', bodyCount: 1 });
    expect(preview).not.toHaveProperty('jobId');
    expect(preview).not.toHaveProperty('receipt');
    expect(preview).not.toHaveProperty('analysisCompatibility');
  });

  it.each(['evaluate', 'read', 'decode', 'finish'] as const)(
    'does not publish a cancelled/obsolete draft while %s is pending',
    async (stage) => {
      const { project, bridge } = fixture();
      let owned = true;
      let resume!: () => void;
      let reached!: () => void;
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const original = bridge[stage].getMockImplementation()!;
      bridge[stage].mockImplementationOnce((async () => {
        reached();
        await pending;
        return original();
      }) as never);
      const running = previewCadCommand(project, 'request', 'document', () => owned, bridge);
      await started;
      owned = false;
      resume();
      expect(await running).toBeNull();
      expect(bridge.finish).toHaveBeenCalledExactlyOnceWith('pending-draft', 'document', false);
    },
  );

  it.each(['read', 'decode'] as const)('cleans pending artifacts when %s fails', async (stage) => {
    const { project, bridge } = fixture();
    bridge[stage].mockRejectedValueOnce(new Error('Corrupt display buffer'));
    await expect(
      previewCadCommand(project, 'request', 'document', () => true, bridge),
    ).rejects.toThrow('Corrupt display buffer');
    expect(bridge.finish).toHaveBeenCalledExactlyOnceWith('pending-draft', 'document', false);
  });

  it('does not publish a preview if artifact cleanup fails', async () => {
    const { project, bridge } = fixture();
    bridge.finish.mockRejectedValue(new Error('Cleanup failed'));
    await expect(
      previewCadCommand(project, 'request', 'document', () => true, bridge),
    ).rejects.toThrow('Cleanup failed');
    expect(bridge.finish.mock.calls.every((call) => (call as unknown[])[2] === false)).toBe(true);
  });

  it('does not invent a staged job when native evaluation rejects', async () => {
    const { project, bridge } = fixture();
    bridge.evaluate.mockRejectedValueOnce(new Error('Exact geometry is invalid'));
    await expect(
      previewCadCommand(project, 'request', 'document', () => true, bridge),
    ).rejects.toThrow('Exact geometry is invalid');
    expect(bridge.read).not.toHaveBeenCalled();
    expect(bridge.finish).not.toHaveBeenCalled();
  });
});
