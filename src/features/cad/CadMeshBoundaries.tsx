import { useState } from 'react';
import { CheckCircle2, Link2, Search, X } from 'lucide-react';
import { formatValue, lengthFactor } from '../../domain/units';
import type { CadMeshInspection } from './useCadMeshInspection';

export default function CadMeshBoundaries({
  inspection,
  units,
}: {
  inspection: CadMeshInspection;
  units: 'm' | 'mm';
}) {
  const [query, setQuery] = useState('');
  const mesh = inspection.mesh;
  if (!mesh) return null;
  const { correspondence, regions } = mesh.receipt;
  const faces = new Map(inspection.exact?.faces.map((face) => [face.id, face.name]));
  const name = (index: number) => faces.get(regions[index].cadFaceId ?? '') ?? regions[index].name;
  const filtered = regions
    .map((region, index) => ({ region, index }))
    .filter(({ region, index }) =>
      `${name(index)} ${region.name}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
  const selected = regions[inspection.index];
  return (
    <section className="cad-mesh-boundaries" aria-label="Boundary correspondence">
      <h3>Boundary correspondence</h3>
      {correspondence.status === 'verified' ? (
        <p className="cad-mesh-matched">
          <CheckCircle2 size={15} /> {regions.length} of {regions.length} CAD faces matched
        </p>
      ) : (
        <p className="cad-mesh-note" role="status">
          <strong>CAD correspondence unavailable</strong>
          {correspondence.reason}
        </p>
      )}
      <div className="cad-mesh-view" role="group" aria-label="Inspection view">
        <button
          type="button"
          aria-pressed={inspection.view === 'mesh'}
          onClick={() => inspection.setView('mesh')}
        >
          Mesh
        </button>
        <button
          type="button"
          aria-pressed={inspection.view === 'cad'}
          disabled={!inspection.canShowCad}
          title={
            inspection.canShowCad
              ? 'Inspect the matching exact CAD face'
              : 'Exact face correspondence is required'
          }
          onClick={() => inspection.setView('cad')}
        >
          CAD faces
        </button>
      </div>
      <p className="cad-hint">
        Select a boundary below or click a face in the viewport. Shift+F fits the selection.
      </p>
      {regions.length > 8 && (
        <label className="cad-mesh-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label="Find a mesh boundary"
            placeholder="Find a boundary…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <ul className="cad-mesh-boundary-list" aria-label="Mesh boundaries">
        {filtered.slice(0, 80).map(({ region, index }) => (
          <li key={region.id}>
            <button
              type="button"
              aria-pressed={inspection.index === index}
              onClick={() => inspection.selectRegion(index)}
            >
              <span>{name(index)}</span>
              <small>{region.triangleCount.toLocaleString('en')} triangles</small>
              {region.cadFaceId && <Link2 size={13} aria-label="Matched to CAD" />}
            </button>
          </li>
        ))}
      </ul>
      {!filtered.length && <p className="cad-hint">No boundaries match this search.</p>}
      {filtered.length > 80 && (
        <p className="cad-hint">
          Showing 80 of {filtered.length} boundaries. Refine the search to find more.
        </p>
      )}
      {selected && (
        <div className="cad-mesh-boundary-detail" role="status">
          <div>
            <strong>{name(inspection.index)}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Clear inspected boundary"
              onClick={inspection.clear}
            >
              <X size={14} />
            </button>
          </div>
          <span>
            {selected.name} · {selected.triangleCount.toLocaleString('en')} triangles
          </span>
          <span>
            Mesh area · {formatValue(selected.area * lengthFactor(units) ** 2)} {units}²
          </span>
        </div>
      )}
      <p className="cad-hint">
        {correspondence.status === 'verified'
          ? 'Exact face identity was checked after import. The link applies to this unchanged geometry; remeshing retains a matched face selection. Geometry edits require a new check.'
          : 'You can inspect mesh boundaries individually. They cannot identify CAD faces until correspondence is established.'}
      </p>
    </section>
  );
}
