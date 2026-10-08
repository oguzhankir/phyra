import { useEffect, useRef, type ReactNode } from 'react';
import { Check, Eye, X } from 'lucide-react';
import { NumericDraftContext } from '../../shared/forms/PropertyControls';
import type { CadCommandModel } from './commandDraft';
import './CadCommandPanel.css';

/** A command edits transient definition state; only Apply may publish an authored change. */
export default function CadCommandPanel({
  command,
  children,
  onApplied,
}: {
  command: CadCommandModel;
  children: ReactNode;
  onApplied: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const draft = command.draft;
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [draft?.id]);
  if (!draft) return null;
  const busy = draft.status === 'previewing';
  return (
    <aside
      ref={panel}
      className="cad-properties cad-command-panel"
      aria-label={`${draft.label} command`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          void command.cancel();
        }
      }}
    >
      <header className="cad-panel-header">
        <strong>{draft.label}</strong>
        <button
          className="icon-button"
          aria-label="Cancel CAD command"
          onClick={() => void command.cancel()}
        >
          <X size={15} />
        </button>
      </header>
      <div className="cad-details-content">
        <p className="cad-command-intro">
          Set the parameters, then preview the exact shape. Apply keeps one change in your project.
        </p>
        <NumericDraftContext.Provider value={command.reportInputDraft}>
          {children}
        </NumericDraftContext.Provider>
      </div>
      <div className="cad-command-feedback" aria-live="polite">
        {draft.error ? (
          <p role="alert">{draft.error}</p>
        ) : busy ? (
          <p>Building command preview…</p>
        ) : draft.preview ? (
          <p>
            Preview ready · {draft.preview.bodyCount} bodies · {draft.preview.faceCount} faces
          </p>
        ) : (
          <p>Changes stay in this draft until you apply them.</p>
        )}
        {command.inputBlocked && (
          <p>Finish or revert the active input before previewing or applying.</p>
        )}
      </div>
      <footer className="cad-command-actions">
        <button
          className="secondary"
          disabled={busy || command.inputBlocked || draft.status === 'ready'}
          onClick={() => void command.preview()}
        >
          <Eye size={15} /> Preview
        </button>
        <button
          className="primary"
          disabled={draft.status !== 'ready' || command.inputBlocked}
          onClick={() => {
            if (command.apply()) onApplied();
          }}
        >
          <Check size={15} /> Apply
        </button>
        <button className="text-button" onClick={() => void command.cancel()}>
          Cancel
        </button>
      </footer>
    </aside>
  );
}
