import type { RegionId } from '../../domain/project/regions';

interface Props {
  assigned: RegionId[];
  regions: { id: RegionId; name: string }[];
  selected: RegionId[];
  onChange: (regions: RegionId[]) => void;
}

export default function BoundaryAssignments({ assigned, regions, selected, onChange }: Props) {
  return (
    <>
      <div className="boundary-list">
        {regions.map((region) => (
          <label key={region.id}>
            <input
              type="checkbox"
              checked={assigned.includes(region.id)}
              onChange={() =>
                onChange(
                  assigned.includes(region.id)
                    ? assigned.filter((candidate) => candidate !== region.id)
                    : [...assigned, region.id],
                )
              }
            />
            <span>{region.name}</span>
            <code>{region.id}</code>
          </label>
        ))}
      </div>
      {assigned
        .filter((id) => !regions.some((region) => region.id === id))
        .map((id) => (
          <div key={id} className="draft-error">
            Missing boundary: <code>{id}</code>
            <button
              className="secondary full"
              onClick={() => onChange(assigned.filter((value) => value !== id))}
            >
              Remove missing assignment
            </button>
          </div>
        ))}
      <button
        className="secondary full"
        disabled={!selected.length}
        onClick={() => onChange([...selected])}
      >
        Use viewport selection ({selected.length})
      </button>
    </>
  );
}
