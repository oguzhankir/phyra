import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { parseNumericDraft } from './numericDraft';
import { formatValue } from '../../domain/units';

export const NumericDraftContext = createContext<(id: string, invalidLabel: string | null) => void>(
  () => {},
);

export function NumberInput({
  label,
  value,
  onChange,
  unit,
  disabled = false,
  physical = true,
  positive = false,
  minimum = -Infinity,
  maximum = Infinity,
  commitMode = 'immediate',
  format,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  disabled?: boolean;
  physical?: boolean;
  positive?: boolean;
  minimum?: number;
  maximum?: number;
  commitMode?: 'immediate' | 'finish';
  /** Formatting changes text only; untouched text never writes a rounded physical value. */
  format?: (value: number) => string;
}) {
  const id = useId();
  const reportValidity = useContext(NumericDraftContext);
  const presentation = useRef(format);
  presentation.current = format;
  const present = (number: number) => presentation.current?.(number) ?? String(number);
  const [text, setText] = useState(() => present(value));
  const textRef = useRef(text);
  textRef.current = text;
  const unfinished = useRef(false);
  const previousValue = useRef(value);
  const validValue = (draft: string): number | null => {
    const parsed = parseNumericDraft(draft);
    return parsed !== null && (!positive || parsed > 0) && parsed >= minimum && parsed <= maximum
      ? parsed
      : null;
  };
  const invalid =
    parseNumericDraft(text) === null ||
    (positive && !(Number(text) > 0)) ||
    Number(text) < minimum ||
    Number(text) > maximum;
  useEffect(() => {
    const parsed = parseNumericDraft(textRef.current);
    if (
      (commitMode === 'finish' && !Object.is(previousValue.current, value)) ||
      (commitMode === 'immediate' &&
        (parsed === null ||
          Math.abs(parsed - value) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4))
    ) {
      const next = presentation.current?.(value) ?? String(value);
      textRef.current = next;
      setText(next);
      unfinished.current = false;
      if (physical) reportValidity(id, null);
    }
    previousValue.current = value;
  }, [value, id, physical, reportValidity, commitMode]);
  useEffect(
    () => () => {
      if (physical) reportValidity(id, null);
    },
    [id, physical, reportValidity],
  );
  const finish = () => {
    if (commitMode !== 'finish' || !unfinished.current) return;
    const parsed = validValue(textRef.current);
    if (parsed === null) return;
    unfinished.current = false;
    const next = present(parsed);
    textRef.current = next;
    setText(next);
    if (physical) reportValidity(id, null);
    onChange(parsed);
  };
  return (
    <label className="field-label">
      <span>{label}</span>
      <div className={`input-with-unit ${invalid ? 'invalid-input' : ''}`}>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={invalid}
          disabled={disabled}
          onChange={(event) => {
            const draft = event.target.value;
            textRef.current = draft;
            setText(draft);
            const parsed = validValue(draft);
            if (commitMode === 'finish') {
              unfinished.current = draft !== present(value);
              if (physical)
                reportValidity(id, unfinished.current || parsed === null ? label : null);
            } else {
              if (physical) reportValidity(id, parsed !== null ? null : label);
              if (parsed !== null) onChange(parsed);
            }
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              unfinished.current = false;
              const next = present(value);
              textRef.current = next;
              setText(next);
              if (physical) reportValidity(id, null);
            } else if (event.key === 'Enter' && commitMode === 'finish') {
              event.preventDefault();
              finish();
            }
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
      {invalid && (
        <small className="draft-error">
          {positive
            ? `Enter a positive number${Number.isFinite(maximum) ? ` at most ${maximum}` : ''}, or press Escape to revert.`
            : Number.isFinite(minimum) || Number.isFinite(maximum)
              ? `Enter a number${Number.isFinite(minimum) ? ` at least ${minimum}` : ''}${Number.isFinite(maximum) ? ` at most ${maximum}` : ''}, or press Escape to revert.`
              : 'Complete the number, or press Escape to revert.'}
        </small>
      )}
    </label>
  );
}
export function Group({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="property-group">
      <div className="group-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Metric({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {formatValue(value)} <small>{unit}</small>
      </strong>
    </div>
  );
}
