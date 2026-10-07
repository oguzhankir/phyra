import { useMemo, useRef, useEffect, useState } from 'react';
import { X, Play, Square } from 'lucide-react';
import type { CadMeshPreview } from '../../domain/geometry/cadMesh';
import { formatValue, lengthFactor } from '../../domain/units';
import { parseNumericDraft } from '../../shared/forms/numericDraft';
import './CadMeshPanel.css';

export default function CadMeshPanel({
  mesh,
  units,
  defaultSize,
  busy,
  blocked,
  reason,
  onGenerate,
  onCancel,
  onClose,
}: {
  mesh: CadMeshPreview | null;
  units: 'm' | 'mm';
  defaultSize: number;
  busy: boolean;
  blocked: boolean;
  reason: string | null;
  onGenerate: (size: number) => Promise<boolean>;
  onCancel: () => Promise<void>;
  onClose: () => void;
}) {
  const factor = lengthFactor(units);
  const [text, setText] = useState(() =>
    String((mesh?.receipt.targetSize ?? defaultSize) * factor),
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const value = parseNumericDraft(text);
  const valid = value !== null && value > 0 && value / factor <= 1000;
  const requestedSize = valid ? value / factor : null;
  const stats = mesh?.receipt.statistics;
  const histogram = useMemo(() => {
    const bins = new Array<number>(10).fill(0);
    mesh?.quality.forEach((quality) => {
      bins[Math.min(9, Math.floor(quality * 10))]++;
    });
    return bins;
  }, [mesh]);
  const maximum = Math.max(1, ...histogram);
  return (
    <aside
      className="cad-properties cad-mesh-panel"
      aria-label="Mesh inspection"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="cad-panel-header">
        <strong>Mesh inspection</strong>
        <button className="icon-button" aria-label="Close mesh inspection" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="cad-mesh-content">
        <p className="cad-hint">
          Generate a tetrahedral mesh of one closed solid. Inspect the boundary triangles and
          element quality before preparing an analysis.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!blocked && !busy && requestedSize) void onGenerate(requestedSize);
          }}
        >
          <label className="field-label">
            <span>Target element size</span>
            <div className={`input-with-unit ${valid ? '' : 'invalid-input'}`}>
              <input
                ref={input}
                value={text}
                inputMode="decimal"
                aria-invalid={!valid}
                disabled={busy}
                onChange={(event) => setText(event.target.value)}
              />
              <span>{units}</span>
            </div>
          </label>
          {!valid && (
            <small className="draft-error">
              Enter a positive, finite length no greater than 1000 m.
            </small>
          )}
          {reason && <p className="cad-hint">{reason}</p>}
          {busy ? (
            <button type="button" className="cad-mesh-generate" onClick={() => void onCancel()}>
              <Square size={14} /> Cancel meshing
            </button>
          ) : (
            <button
              type="submit"
              className="primary cad-mesh-generate"
              disabled={blocked || !valid}
            >
              <Play size={14} /> {mesh ? 'Regenerate mesh' : 'Generate mesh'}
            </button>
          )}
        </form>
        {stats && (
          <>
            <div className="cad-mesh-method">
              <strong>
                Tetra4 · {mesh!.receipt.mesher.name} {mesh!.receipt.mesher.version}
              </strong>
              <span>
                {formatValue(mesh!.receipt.targetSize * factor)} {units} target size
              </span>
            </div>
            {requestedSize !== mesh!.receipt.targetSize && (
              <p className="cad-mesh-note" role="status">
                The displayed mesh uses the previous size. Regenerate to apply the new size.
              </p>
            )}
            <dl className="cad-mesh-metrics">
              <dt>Nodes</dt>
              <dd>{stats.nodes.toLocaleString('en')}</dd>
              <dt>Tetrahedra</dt>
              <dd>{stats.cells.toLocaleString('en')}</dd>
              <dt>Boundary triangles</dt>
              <dd>{stats.surfaceTriangles.toLocaleString('en')}</dd>
              <dt>Minimum quality</dt>
              <dd>{formatValue(stats.minQuality)}</dd>
              <dt>Mean quality</dt>
              <dd>{formatValue(stats.meanQuality)}</dd>
              <dt>Maximum quality</dt>
              <dd>{formatValue(stats.maxQuality)}</dd>
            </dl>
            <figure className="cad-mesh-quality">
              <figcaption>Element quality distribution</figcaption>
              <div
                className="cad-mesh-histogram"
                role="img"
                aria-label={histogram
                  .map((count, i) => `${i / 10} to ${(i + 1) / 10}: ${count} tetrahedra`)
                  .join('; ')}
              >
                {histogram.map((count, i) => (
                  <span
                    key={i}
                    style={{ height: `${(100 * count) / maximum}%` }}
                    title={`${i / 10}–${(i + 1) / 10}: ${count} tetrahedra`}
                  />
                ))}
              </div>
              <div className="cad-mesh-quality-scale">
                <span>0 · degenerate</span>
                <span>1 · regular</span>
              </div>
              <p className="cad-hint">
                Mean-ratio quality describes element shape. It does not establish solution accuracy.
              </p>
            </figure>
            <dl className="cad-mesh-metrics">
              <dt>Exact solid volume</dt>
              <dd>
                {formatValue(stats.exactVolume * factor ** 3)} {units}³
              </dd>
              <dt>Mesh volume</dt>
              <dd>
                {formatValue(stats.meshVolume * factor ** 3)} {units}³
              </dd>
              <dt>Volume difference</dt>
              <dd>{formatValue(stats.relativeVolumeError * 100)}%</dd>
            </dl>
            <p className="cad-hint">
              Curved faces are approximated by flat triangles. Refine the size and compare volume
              and quality to assess the discretization.
            </p>
          </>
        )}
        <p className="cad-mesh-note">
          Inspection only. This mesh is temporary and does not enable a solver, assign loads or
          change the saved geometry. Boundary labels belong to this mesh, not to persistent CAD
          faces.
        </p>
      </div>
    </aside>
  );
}
