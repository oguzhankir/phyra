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
  maximum = Infinity,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  disabled?: boolean;
  physical?: boolean;
  positive?: boolean;
  maximum?: number;
}) {
  const id = useId();
  const reportValidity = useContext(NumericDraftContext);
  const [text, setText] = useState(String(value));
  const textRef = useRef(text);
  textRef.current = text;
  const invalid =
    parseNumericDraft(text) === null || (positive && !(Number(text) > 0)) || Number(text) > maximum;
  useEffect(() => {
    const parsed = parseNumericDraft(textRef.current);
    if (
      parsed === null ||
      Math.abs(parsed - value) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4
    ) {
      setText(String(value));
      if (physical) reportValidity(id, null);
    }
  }, [value, id, physical, reportValidity]);
  useEffect(
    () => () => {
      if (physical) reportValidity(id, null);
    },
    [id, physical, reportValidity],
  );
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
            const parsed = parseNumericDraft(draft);
            const valid = parsed !== null && (!positive || parsed > 0) && parsed <= maximum;
            if (physical) reportValidity(id, valid ? null : label);
            if (valid) onChange(parsed!);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setText(String(value));
              if (physical) reportValidity(id, null);
            }
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
      {invalid && (
        <small className="draft-error">
          {positive
            ? `Enter a positive number${Number.isFinite(maximum) ? ` at most ${maximum}` : ''}, or press Escape to revert.`
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
