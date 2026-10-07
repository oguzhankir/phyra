import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CadFeature } from '../../domain/contracts/project.generated';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import CadAdvancedFields from './CadAdvancedFields';
import {
  advancedIssue,
  newAdvancedFeature,
  type AdvancedFeature,
  type AdvancedKind,
} from './advancedFeatures';

export default function CadFeatureDialog({
  kind,
  features,
  selectedId,
  onCreate,
  onClose,
}: {
  kind: AdvancedKind;
  features: readonly CadFeature[];
  selectedId?: string;
  onCreate: (feature: AdvancedFeature) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => newAdvancedFeature(kind, features, selectedId));
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
          <CadAdvancedFields value={draft} features={features} onChange={setDraft} />
          <div className="cad-operation-note">
            <strong>Exact geometry, evaluated locally</strong>
            <p>
              After creation, rebuild checks the operation and shows any failing feature. This
              geometry can be saved and exported. Analysis remains unavailable for these operations.
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
            disabled={!!issue}
            onClick={() => {
              onCreate(draft);
              onClose();
            }}
          >
            Create {kind}
          </button>
        </footer>
      </div>
    </div>
  );
}
