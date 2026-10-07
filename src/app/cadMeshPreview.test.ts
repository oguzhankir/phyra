import { describe, expect, it, vi } from 'vitest';
import type { ProjectDefinition } from '../domain/contracts/types';
import type { CadMeshPreview, CadMeshReceipt } from '../domain/geometry/cadMesh';
import { previewCadMesh } from './cadMeshPreview';

function fixture() {
  const receipt = { jobId: 'mesh-job' } as CadMeshReceipt;
  const preview = { receipt } as CadMeshPreview;
  return {
    preview,
    bridge: {
      inspect: vi.fn(async () => receipt),
      read: vi.fn(async () => new ArrayBuffer(0)),
      decode: vi.fn(async () => preview),
      finish: vi.fn(async () => {}),
    },
  };
}
const project = { id: 'part', revision: 2 } as ProjectDefinition;
describe('mesh inspection publication ownership', () => {
  it('discards native staging before publication and never accepts inspection as exact CAD', async () => {
    const { preview, bridge } = fixture();
    expect(await previewCadMesh(project, 0.1, 'request', 'document', () => true, bridge)).toBe(
      preview,
    );
    expect(bridge.finish).toHaveBeenCalledExactlyOnceWith('mesh-job', 'document', false);
  });
  it('discards late jobs without reading or publishing and rejects failed cleanup', async () => {
    const first = fixture();
    expect(
      await previewCadMesh(project, 0.1, 'request', 'document', () => false, first.bridge),
    ).toBeNull();
    expect(first.bridge.read).not.toHaveBeenCalled();
    expect(first.bridge.finish).toHaveBeenCalledExactlyOnceWith('mesh-job', 'document', false);
    const second = fixture();
    second.bridge.finish.mockRejectedValue(new Error('cleanup failed'));
    await expect(
      previewCadMesh(project, 0.1, 'request', 'document', () => true, second.bridge),
    ).rejects.toThrow('cleanup failed');
  });
  it('rechecks ownership after decoding and after asynchronous cleanup', async () => {
    for (const stage of ['decode', 'finish'] as const) {
      const { bridge, preview } = fixture();
      let owned = true;
      if (stage === 'decode')
        bridge.decode.mockImplementation(async () => {
          owned = false;
          return preview;
        });
      else
        bridge.finish.mockImplementation(async () => {
          owned = false;
        });
      expect(
        await previewCadMesh(project, 0.1, 'request', 'document', () => owned, bridge),
      ).toBeNull();
      expect(bridge.finish).toHaveBeenCalledExactlyOnceWith('mesh-job', 'document', false);
    }
  });
});
