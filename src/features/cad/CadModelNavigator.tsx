import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import type { CadFeature, CadGeometry } from '../../domain/contracts/project.generated';
import type { CadPreview } from '../../domain/geometry/cadPreview';
import { featureDependencies } from '../../domain/project/document';
import Select from '../../shared/ui/Select';
import { sourceSketch } from './advancedFeatures';
import { cadFeatureLabel } from './cadLabels';

export type CadSelectionKind = 'body' | 'face' | 'edge';

export default function CadModelNavigator({
  geometry,
  selectedFeatureId,
  disabled,
  emptyContent,
  preview,
  selectionKind,
  selectedEntities,
  hiddenBodies,
  onSelectFeature,
  onEditSketch,
  onUseOutput,
  onSelectionKind,
  onSelectEntity,
  onIsolate,
  onShowAll,
  onCollapse,
}: {
  geometry: CadGeometry | null;
  selectedFeatureId?: string;
  disabled: boolean;
  emptyContent: ReactNode;
  preview: CadPreview | null;
  selectionKind: CadSelectionKind;
  selectedEntities: string[];
  hiddenBodies: string[];
  onSelectFeature: (id: string) => void;
  onEditSketch: (id: string) => void;
  onUseOutput: (id: string) => void;
  onSelectionKind: (kind: CadSelectionKind) => void;
  onSelectEntity: (id: string) => void;
  onIsolate: () => void;
  onShowAll: () => void;
  onCollapse: () => void;
}) {
  const [tab, setTab] = useState<'model' | 'operations'>('model');
  const tabsId = useId();
  const features = geometry?.features ?? [];
  const output = features.find((item) => item.id === geometry?.outputFeatureId);
  const chosen = features.find((item) => item.id === selectedFeatureId);
  const sketches = features.filter(
    (item) => item.id !== output?.id && !!sourceSketch(features, item.id),
  );
  const primitives = features.filter(
    (item) => item.id !== output?.id && ['box', 'cylinder', 'import-step'].includes(item.kind),
  );
  const entities = preview
    ? selectionKind === 'body'
      ? preview.bodies
      : selectionKind === 'face'
        ? preview.faces
        : preview.edges
    : [];
  const itemButton = (item: CadFeature, index?: number) => (
    <button
      className={selectedFeatureId === item.id ? 'active' : ''}
      disabled={disabled}
      aria-current={item.id === geometry?.outputFeatureId ? true : undefined}
      onClick={() => onSelectFeature(item.id)}
      onDoubleClick={() => item.kind === 'sketch' && onEditSketch(item.id)}
    >
      {index !== undefined && <small>{index + 1}</small>}
      <span>
        <span className="cad-object-name">{item.name}</span>
        <em>
          {cadFeatureLabel(item)}
          {item.id === geometry?.outputFeatureId ? ' · Output' : ''}
        </em>
      </span>
    </button>
  );
  return (
    <aside className="cad-tree" id="cad-model-navigator" aria-label="Model navigator">
      <header className="cad-panel-header">
        <strong>Model navigator</strong>
        <button className="icon-button" aria-label="Hide model navigator" onClick={onCollapse}>
          <PanelLeftClose size={15} />
        </button>
      </header>
      <div className="cad-navigator-tabs" role="tablist" aria-label="Model navigator views">
        {(['model', 'operations'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            id={`${tabsId}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'model'
                    : event.key === 'End'
                      ? 'operations'
                      : value === 'model'
                        ? 'operations'
                        : 'model';
                setTab(next);
                document.getElementById(`${tabsId}-${next}`)?.focus();
              }
            }}
          >
            {value === 'model' ? 'Model' : 'Operations'}
          </button>
        ))}
      </div>
      <div
        className="cad-navigator-content"
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${tab}`}
      >
        {!geometry ? (
          emptyContent
        ) : (
          <>
            <section className="cad-current-output">
              <h2>Current output</h2>
              {output && itemButton(output)}
              <p className="cad-hint">The exact view and analysis check use this output.</p>
            </section>
            {tab === 'operations' ? (
              <>
                <h2>Feature history</h2>
                <ol className="cad-operation-list">
                  {features.map((item, index) => (
                    <li key={item.id}>
                      {itemButton(item, index)}
                      {!!featureDependencies(item).length && (
                        <div className="cad-operation-inputs" aria-label={`${item.name} inputs`}>
                          <ChevronRight size={11} aria-hidden="true" />
                          <span>Inputs</span>
                          {featureDependencies(item).map((id) => (
                            <button
                              key={id}
                              disabled={disabled}
                              onClick={() => onSelectFeature(id)}
                            >
                              {features.find((input) => input.id === id)?.name ?? id}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                {!!sketches.length && (
                  <section>
                    <h2>Sketches & paths</h2>
                    <ol>
                      {sketches.map((item) => (
                        <li key={item.id}>{itemButton(item)}</li>
                      ))}
                    </ol>
                  </section>
                )}
                {!!primitives.length && (
                  <section>
                    <h2>Source solids</h2>
                    <ol>
                      {primitives.map((item) => (
                        <li key={item.id}>{itemButton(item)}</li>
                      ))}
                    </ol>
                  </section>
                )}
                {output?.kind === 'assembly' && (
                  <section>
                    <h2>Component instances</h2>
                    <ol>
                      {output.components.map((component) => (
                        <li key={component.id}>
                          <button
                            disabled={disabled}
                            onClick={() => onSelectFeature(component.featureId)}
                          >
                            <span>
                              <span className="cad-object-name">{component.name}</span>
                              <em>
                                Source:{' '}
                                {features.find((item) => item.id === component.featureId)?.name ??
                                  component.featureId}
                              </em>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                {chosen &&
                  chosen.id !== output?.id &&
                  !sketches.some((item) => item.id === chosen.id) &&
                  !primitives.some((item) => item.id === chosen.id) && (
                    <section>
                      <h2>Selected operation</h2>
                      {itemButton(chosen)}
                    </section>
                  )}
                {!sketches.length && !primitives.length && output?.kind !== 'assembly' && (
                  <p className="cad-hint">
                    Open Operations to inspect inputs and change earlier features.
                  </p>
                )}
              </>
            )}
            {chosen && chosen.id !== geometry.outputFeatureId && (
              <button
                className="secondary full"
                disabled={disabled || chosen.id === geometry.outputFeatureId}
                onClick={() => onUseOutput(chosen.id)}
              >
                Use selected feature as output
              </button>
            )}
          </>
        )}
        {preview && (
          <details className="cad-entity-section">
            <summary>
              Geometry entities <span>{preview.bodies.length} bodies</span>
            </summary>
            <Select
              aria-label="CAD entity selection"
              value={selectionKind}
              options={[
                { value: 'body', label: 'Bodies' },
                { value: 'face', label: 'Faces' },
                { value: 'edge', label: 'Edges' },
              ]}
              onChange={(value) => onSelectionKind(value as CadSelectionKind)}
            />
            <div className="cad-entity-list">
              {entities.map((entity) => (
                <label key={entity.id}>
                  <input
                    type="checkbox"
                    checked={selectedEntities.includes(entity.id)}
                    onChange={() => onSelectEntity(entity.id)}
                  />
                  <span>
                    {entity.name}
                    {entity.identity === 'ambiguous' && <small>Ambiguous identity</small>}
                  </span>
                </label>
              ))}
            </div>
            {!!preview.bodies.length && (
              <div className="cad-body-controls">
                <button
                  className="secondary full"
                  disabled={
                    !selectedEntities.some((id) => preview.bodies.some((body) => body.id === id))
                  }
                  onClick={onIsolate}
                >
                  Isolate selected bodies
                </button>
                <button
                  className="secondary full"
                  disabled={!hiddenBodies.length}
                  onClick={onShowAll}
                >
                  Show all bodies
                </button>
                <p className="cad-hint">
                  Visibility affects only this view. Select Bodies, then click a component.
                </p>
              </div>
            )}
          </details>
        )}
      </div>
    </aside>
  );
}
