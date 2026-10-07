import { useEffect, useRef, type ReactNode } from 'react';
import { Download, X } from 'lucide-react';
import { formatValue, lengthFactor } from '../../domain/units';
import Select from '../../shared/ui/Select';
import type { CadWorkspaceModel } from './model';

export type CadDetailsSection = 'properties' | 'measure' | 'analysis' | 'export';
const sections: Record<CadDetailsSection, string> = {
  properties: 'Properties',
  measure: 'Measurements',
  analysis: 'Analysis support',
  export: 'Export geometry',
};

/** On-demand detail surface; current exact receipts alone enable measurements and export. */
export default function CadDetailsPanel({
  section,
  onSection,
  onClose,
  children,
  featureName,
  featureKind,
  evaluation,
  units,
  exportUnits,
  onExportUnits,
  exportDisabled,
  onExport,
}: {
  section: CadDetailsSection;
  onSection: (section: CadDetailsSection) => void;
  onClose: () => void;
  children: ReactNode;
  featureName?: string;
  featureKind?: string;
  evaluation: CadWorkspaceModel['evaluation'];
  units: 'm' | 'mm';
  exportUnits: 'm' | 'mm';
  onExportUnits: (units: 'm' | 'mm') => void;
  exportDisabled: boolean;
  onExport: (format: 'step' | 'brep', units: 'm' | 'mm') => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, [section]);
  const factor = lengthFactor(units);
  const componentOutput = evaluation?.preview.bodies.some((body) => body.componentPath?.length);
  return (
    <aside
      ref={panel}
      className="cad-properties"
      aria-label={sections[section]}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="cad-panel-header">
        <strong>{sections[section]}</strong>
        <button
          ref={close}
          className="icon-button"
          aria-label="Close CAD details"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <nav className="cad-detail-navigation" aria-label="CAD details">
        {(Object.keys(sections) as CadDetailsSection[]).map((value) => (
          <button
            key={value}
            aria-current={section === value ? 'page' : undefined}
            onClick={() => onSection(value)}
          >
            {value === 'measure'
              ? 'Measure'
              : value === 'analysis'
                ? 'Analysis'
                : value === 'export'
                  ? 'Export'
                  : 'Properties'}
          </button>
        ))}
      </nav>
      <div className="cad-details-content">
        {section === 'properties' && (
          <>
            <div className="cad-property-context">
              <strong>{featureName ?? 'No feature selected'}</strong>
              {featureKind && <span>{featureKind}</span>}
            </div>
            {children}
          </>
        )}
        {section === 'measure' &&
          (evaluation ? (
            <div className="cad-shape-summary">
              <h2>Exact shape measurements</h2>
              <dl>
                <dt>{componentOutput ? 'Component volume sum' : 'Volume'}</dt>
                <dd>
                  {formatValue(evaluation.volume * factor ** 3)} {units}³
                </dd>
                <dt>Surface area</dt>
                <dd>
                  {formatValue(evaluation.surfaceArea * factor ** 2)} {units}²
                </dd>
              </dl>
              {componentOutput && (
                <p className="cad-hint">
                  Overlaps are counted per instance. Placement creates no bonds or contact.
                </p>
              )}
              <p className="cad-hint">
                Measurements describe the current exact output. Display triangles are a viewing
                approximation.
              </p>
            </div>
          ) : (
            <p className="cad-hint">
              Rebuild the current output to obtain exact volume and surface area.
            </p>
          ))}
        {section === 'analysis' &&
          (evaluation ? (
            <div className={`cad-analysis-support ${evaluation.analysisCompatibility.state}`}>
              <h2>Analysis support</h2>
              <strong>
                {evaluation.analysisCompatibility.state === 'supported'
                  ? 'Supported analysis path'
                  : 'CAD ready · analysis unavailable'}
              </strong>
              <p>{evaluation.analysisCompatibility.reason}</p>
              {evaluation.analysisCompatibility.state === 'unsupported' && (
                <span>You can continue modeling, save this geometry or export it.</span>
              )}
              <p className="cad-hint">
                Geometry validity and analysis support are separate. The project overview reports
                the current exact geometry’s available analysis paths.
              </p>
            </div>
          ) : (
            <p className="cad-hint">
              Rebuild the current output to check its supported analysis paths. Saved features and
              an older preview do not establish solver support.
            </p>
          ))}
        {section === 'export' && (
          <div className="cad-export">
            <h2>Export geometry</h2>
            <label className="field-label">
              <span>STEP units</span>
              <Select
                aria-label="CAD export units"
                value={exportUnits}
                options={[
                  { value: 'm', label: 'Meters' },
                  { value: 'mm', label: 'Millimeters' },
                ]}
                onChange={(value) => onExportUnits(value as 'm' | 'mm')}
              />
            </label>
            <button
              className="secondary full"
              disabled={exportDisabled}
              onClick={() => onExport('step', exportUnits)}
            >
              <Download size={14} /> Export STEP
            </button>
            <button
              className="secondary full"
              disabled={exportDisabled}
              onClick={() => onExport('brep', 'm')}
            >
              Export B-rep (SI)
            </button>
            <p className="cad-hint">
              Export uses the current exact output. Rebuild after changing geometry; STEP exchange
              does not imply analysis support.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
