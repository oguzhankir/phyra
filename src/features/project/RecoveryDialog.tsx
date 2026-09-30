import './RecoveryDialog.css';
import { History, X } from 'lucide-react';
import type { RecoveryRecord } from '../../platform/desktop/recovery';
type Props = {
  records: RecoveryRecord[];
  pending: boolean;
  onRestore: (record: RecoveryRecord) => void;
  onDiscard: (record: RecoveryRecord) => void;
  onLater: () => void;
};
export default function RecoveryDialog({ records, pending, onRestore, onDiscard, onLater }: Props) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
      >
        <header>
          <History size={18} />
          <h2 id="recovery-title">Recover an unsaved project</h2>
          <button
            className="icon-button"
            disabled={pending}
            onClick={onLater}
            aria-label="Review recovery later"
          >
            <X size={16} />
          </button>
        </header>
        <p>
          These definitions were preserved from a previous launch. Results must be recomputed; the
          original project file will not be overwritten.
        </p>
        <div className="recovery-records">
          {records.map((record) => (
            <article key={record.id}>
              <div>
                <strong>{record.projectName}</strong>
                <small>
                  Revision {record.revision} · {new Date(record.savedAt).toLocaleString()}
                </small>
              </div>
              <button className="secondary" disabled={pending} onClick={() => onDiscard(record)}>
                Discard copy
              </button>
              <button className="primary" disabled={pending} onClick={() => onRestore(record)}>
                {pending ? 'Working…' : 'Restore'}
              </button>
            </article>
          ))}
        </div>
        <button className="text-button" disabled={pending} onClick={onLater}>
          Review later
        </button>
      </section>
    </div>
  );
}
