import { useMemo, useState } from 'react';
import { cadMeshDisplay, type CadMeshPreview } from '../../domain/geometry/cadMesh';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import {
  selectMeshBoundary,
  selectedMeshBoundary,
  type CadMeshSelection,
} from './cadMeshSelection';

/** Inspection owns its own selection; authoring selections and geometry stay untouched. */
export function useCadMeshInspection(mesh: CadMeshPreview | null, exact: CadPreview | null) {
  const [requestedView, setView] = useState<'mesh' | 'cad'>('mesh');
  const [selection, setSelection] = useState<CadMeshSelection>(null);
  const display = useMemo(() => (mesh ? cadMeshDisplay(mesh) : null), [mesh]);
  const canShowCad = !!exact && mesh?.receipt.correspondence.status === 'verified';
  const view = canShowCad ? requestedView : 'mesh';
  const index = mesh ? selectedMeshBoundary(mesh.receipt, selection) : -1;
  const region = mesh?.receipt.regions[index];
  const selectRegion = (next: number) =>
    setSelection(mesh ? selectMeshBoundary(mesh.receipt, next) : null);
  return {
    mesh,
    exact,
    canShowCad,
    view,
    setView,
    index,
    selectRegion,
    clear: () => setSelection(null),
    preview: view === 'cad' ? exact : display,
    selected: region
      ? [view === 'cad' ? region.cadFaceId! : `${mesh!.receipt.jobId}:${region.id}`]
      : [],
    selectEntity: (id: string | null) =>
      selectRegion(
        mesh && id
          ? mesh.receipt.regions.findIndex((candidate) =>
              view === 'cad'
                ? candidate.cadFaceId === id
                : `${mesh.receipt.jobId}:${candidate.id}` === id,
            )
          : -1,
      ),
  };
}

export type CadMeshInspection = ReturnType<typeof useCadMeshInspection>;
