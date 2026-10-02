import { CheckCircle2, CircleAlert, ChevronRight, TriangleAlert } from 'lucide-react';
import type { PreparationSection, StudyPreparation } from '../../domain/project/readiness';
import './StudyReadiness.css';

export default function StudyReadiness({
  preparation,
  onSection,
  compact = false,
}: {
  preparation: StudyPreparation;
  onSection: (section: PreparationSection) => void;
  compact?: boolean;
}) {
  return (
    <section
      className={`study-readiness${compact ? ' compact' : ''}`}
      aria-label="Analysis preparation checks"
    >
      <header>
        <div>
          <strong>
            {preparation.canRun ? 'Definition ready for analysis' : 'Complete the study definition'}
          </strong>
          <p>
            {preparation.completed} of {preparation.total} definition checks complete
          </p>
        </div>
        <span className={`readiness-count${preparation.canRun ? ' complete' : ''}`}>
          {preparation.completed}/{preparation.total}
        </span>
      </header>
      <div className="readiness-checks">
        {preparation.checks.map((item) => (
          <button
            key={item.section}
            type="button"
            className={`readiness-check ${item.state}`}
            onClick={() => onSection(item.section)}
            aria-label={`${item.label}: ${item.state}. ${item.detail}`}
          >
            {item.state === 'complete' ? (
              <CheckCircle2 size={16} />
            ) : item.state === 'review' ? (
              <TriangleAlert size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            <span>
              <strong>
                {item.label}
                <small>
                  {item.state === 'complete'
                    ? 'Defined'
                    : item.state === 'review'
                      ? 'Review'
                      : item.state === 'invalid'
                        ? 'Repair'
                        : 'Missing'}
                </small>
              </strong>
              <span>{item.detail}</span>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {!compact && (
        <p className="readiness-note">
          These checks cover the supplied definition. The worker validates the generated mesh and
          numerical problem; a completed checklist does not establish physical accuracy.
        </p>
      )}
    </section>
  );
}
