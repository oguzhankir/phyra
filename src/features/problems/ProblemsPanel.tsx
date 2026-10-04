import DetailDialog from '../../shared/ui/DetailDialog';
import './ProblemsPanel.css';
import { AlertCircle, ChevronDown, ChevronUp, Info, TriangleAlert, X } from 'lucide-react';
import type { Problem } from './problems';
type Props = {
  problems: Problem[];
  open: boolean;
  onToggle: () => void;
  onAction: (problem: Problem) => void;
  onDismiss: () => void;
};
export default function ProblemsPanel({ problems, open, onToggle, onAction, onDismiss }: Props) {
  const errors = problems.filter((item) => item.severity === 'error').length;
  const warnings = problems.filter((item) => item.severity === 'warning').length;
  return (
    <section className="problems-panel" aria-label="Problems and recovery">
      <button className="problems-heading" onClick={onToggle} aria-expanded={open}>
        <span>
          <TriangleAlert size={13} /> Problems <b>{problems.length}</b>
        </span>
        <span>
          {errors > 0 && (
            <small className="problem-error">
              {errors} {errors === 1 ? 'error' : 'errors'}
            </small>
          )}
          {warnings > 0 && (
            <small>
              {warnings} {warnings === 1 ? 'warning' : 'warnings'}
            </small>
          )}
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>
      {open && (
        <div className="problems-body" role="log" aria-live="polite">
          {!problems.length && (
            <p className="problems-empty">
              No current problems. Inputs and results remain subject to the displayed method limits.
            </p>
          )}
          {problems.map((problem) => (
            <article className={`problem-item problem-${problem.severity}`} key={problem.id}>
              <span className="problem-symbol" aria-label={problem.severity}>
                {problem.severity === 'error' ? (
                  <AlertCircle size={15} />
                ) : problem.severity === 'warning' ? (
                  <TriangleAlert size={15} />
                ) : (
                  <Info size={15} />
                )}
              </span>
              <div>
                <strong>{problem.title}</strong>
                <p>{problem.message}</p>
                <button className="text-button" onClick={() => onAction(problem)}>
                  {problem.action}
                </button>
                {problem.details && (
                  <DetailDialog title={<> Technical details </>}>
                    <pre>{problem.details}</pre>
                  </DetailDialog>
                )}
              </div>
              {problem.id === 'operation' && (
                <button
                  className="icon-button"
                  aria-label="Dismiss operation problem"
                  onClick={onDismiss}
                >
                  <X size={13} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
