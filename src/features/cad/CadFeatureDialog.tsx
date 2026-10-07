import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CadFeature } from '../../domain/contracts/project.generated';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import CadAdvancedFields from './CadAdvancedFields';
import { NumericDraftContext } from '../../shared/forms/PropertyControls';
import {
  advancedIssue,
  newAdvancedFeature,
  type AdvancedFeature,
  type AdvancedKind,
} from './advancedFeatures';

export default function CadFeatureDialog({
  kind,
  commandPreview = false,
  features,
  selectedId,
  onCreate,
  onClose,
}: {
  kind: AdvancedKind;
  commandPreview?: boolean;
  features: readonly CadFeature[];
  selectedId?: string;
  onCreate: (feature: AdvancedFeature) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => newAdvancedFeature(kind, features, selectedId));
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const reportInput = useCallback((id: string, label: string | null) => {
    setNumericDrafts((previous) => {
      if ((previous[id] ?? null) === label) return previous;
      const next = { ...previous };
      if (label) next[id] = label;
      else delete next[id];
      return next;
    });
  }, []);
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, onClose, 'cad-feature-dialog', dialog);
  const title =
    kind === 'loft' ? 'Create loft' : kind === 'sweep' ? 'Create sweep' : 'Create assembly';
  const issue = !draft.name.trim() ? 'Give this feature a name.' : advancedIssue(draft, features);
  return (
    <div
      className="cad-plane-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cad-feature-title"
    >
      <div ref={dialog} className="cad-feature-dialog modal">
        <header>
          <div>
            <p className="cad-eyebrow">Surface & assembly</p>
            <h2 id="cad-feature-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close feature dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="cad-feature-dialog-content">
          <label className="field-label">
            <span>Feature name</span>
            <input
              value={draft.name}
              maxLength={200}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <NumericDraftContext.Provider value={reportInput}>
            <CadAdvancedFields value={draft} features={features} onChange={setDraft} />
          </NumericDraftContext.Provider>
          <div className="cad-operation-note">
            <strong>Exact geometry, evaluated locally</strong>
            <p>
              {commandPreview
                ? 'Continue to preview the exact shape, then Apply to keep the command. Rebuild the committed geometry before export.'
                : 'After creation, rebuild in the desktop app checks the exact shape before export.'}{' '}
              Analysis remains unavailable for these operations.
            </p>
          </div>
          {issue && (
            <p className="cad-hint" role="status">
              {issue}
            </p>
          )}
        </div>
        <footer>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!!issue || Object.keys(numericDrafts).length > 0}
            onClick={() => {
              onCreate(draft);
              onClose();
            }}
          >
            {commandPreview ? 'Review command' : `Create ${kind}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
