import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  filterSelectOptions,
  mountSelectPopover,
  nextSelectOption,
  selectPopoverPosition,
  type SelectableOption,
} from './selectPopover';
import './Select.css';

export type SelectOption = SelectableOption & { icon?: ReactNode };

type Props = {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  id?: string;
  className?: string;
  title?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  compact?: boolean;
};

/** A shared single-value selector with a bounded, searchable listbox. */
export default function Select({
  value,
  options,
  onChange,
  label,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search options…',
  placeholder = 'Select…',
  compact = false,
  className = '',
  id,
  ...attributes
}: Props) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-list`;
  const labelId = `${triggerId}-label`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const filtered = useMemo(() => filterSelectOptions(options, query), [options, query]);
  const selected = options.find((option) => option.value === value);
  const activeOption = filtered.find((option) => option.value === active && !option.disabled);
  const activeId = activeOption ? `${listId}-${options.indexOf(activeOption)}` : undefined;
  const accessibleLabel = attributes['aria-label'] ?? label;
  const openList = (key?: 'ArrowDown' | 'ArrowUp') => {
    if (disabled || trigger.current?.matches(':disabled')) return;
    setQuery('');
    setActive(
      selected && !selected.disabled
        ? selected.value
        : nextSelectOption(options, null, key ?? 'ArrowDown'),
    );
    setPosition({ visibility: 'hidden' });
    setOpen(true);
  };
  const choose = (option: SelectOption | undefined) => {
    if (!option || option.disabled || disabled || trigger.current?.matches(':disabled')) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };
  const updatePosition = () => {
    if (!trigger.current || !popover.current || !list.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    setPosition(
      selectPopoverPosition(
        {
          left: anchor.left,
          top: anchor.top,
          bottom: anchor.bottom,
          width: Math.max(anchor.width, searchable ? 260 : 190),
        },
        { width: window.innerWidth, height: window.innerHeight },
        popover.current.scrollHeight + list.current.scrollHeight - list.current.clientHeight,
      ),
    );
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popover.current || !list.current) return;
    const element = popover.current;
    return mountSelectPopover({
      trigger: trigger.current,
      popover: element,
      focusTarget: search.current ?? list.current,
      onClose: () => setOpen(false),
      onPosition: updatePosition,
    });
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    if (!activeOption) setActive(nextSelectOption(filtered, null, 'ArrowDown'));
    if (activeId && list.current) {
      const option = document.getElementById(activeId);
      if (option) {
        const optionBounds = option.getBoundingClientRect();
        const listBounds = list.current.getBoundingClientRect();
        if (optionBounds.top < listBounds.top)
          list.current.scrollTop -= listBounds.top - optionBounds.top;
        else if (optionBounds.bottom > listBounds.bottom)
          list.current.scrollTop += optionBounds.bottom - listBounds.bottom;
      }
    }
  }, [open, filtered, activeOption, activeId]);
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, filtered, searchable]);
  useLayoutEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      const scope = trigger.current?.closest('[aria-modal="true"]') ?? document;
      const focusable = Array.from(
        scope.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'),
      ).filter(
        (element) =>
          !element.matches(':disabled') &&
          element.tabIndex >= 0 &&
          !element.closest('[hidden], [inert]') &&
          element.getClientRects().length > 0 &&
          !popover.current?.contains(element),
      );
      const index = focusable.indexOf(trigger.current!);
      const next = index + (event.shiftKey ? -1 : 1);
      const target =
        scope === document
          ? focusable[next]
          : focusable[(next + focusable.length) % focusable.length];
      target?.focus();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (searchable && (event.key === 'Home' || event.key === 'End')) return;
      event.preventDefault();
      event.stopPropagation();
      setActive(
        nextSelectOption(filtered, active, event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'),
      );
    } else if (event.key === 'Enter' || (!searchable && event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      choose(activeOption);
    } else if (
      !searchable &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const start = filtered.findIndex((option) => option.value === active) + 1;
      const ordered = [...filtered.slice(start), ...filtered.slice(0, start)];
      const match = ordered.find(
        (option) =>
          !option.disabled &&
          option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()),
      );
      if (match) setActive(match.value);
    }
  };
  return (
    <div className={`select-control${compact ? ' select-compact' : ''} ${className}`}>
      {label && (
        <label id={labelId} htmlFor={triggerId} className="select-label">
          {label}
        </label>
      )}
      <button
        {...attributes}
        type="button"
        id={triggerId}
        ref={trigger}
        className="select-trigger"
        role="combobox"
        aria-label={attributes['aria-label']}
        aria-labelledby={attributes['aria-labelledby'] ?? (label ? labelId : undefined)}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (open) {
            onKeyDown(event);
            return;
          }
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            openList(event.key as 'ArrowDown' | 'ArrowUp');
          }
        }}
      >
        {selected?.icon && <span className="select-icon">{selected.icon}</span>}
        <span className={`select-value${selected ? '' : ' select-placeholder'}`}>
          {selected?.label ?? (value || placeholder)}
        </span>
        <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popover}
            className="select-popover"
            data-ui-overlay
            style={position}
            onKeyDown={onKeyDown}
          >
            {searchable && (
              <div className="select-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={search}
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label={`Search ${accessibleLabel ?? 'options'}`}
                  role="combobox"
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
            <div
              id={listId}
              ref={list}
              className="select-options"
              role="listbox"
              tabIndex={searchable ? -1 : 0}
              aria-label={accessibleLabel}
              aria-labelledby={attributes['aria-labelledby'] ?? (label ? labelId : undefined)}
              aria-activedescendant={searchable ? undefined : activeId}
            >
              {!filtered.length && (
                <div className="select-empty" role="status">
                  No options found
                </div>
              )}
              {filtered.map((option, index) => (
                <div key={option.value}>
                  {option.group && (index === 0 || filtered[index - 1].group !== option.group) && (
                    <div className="select-group">{option.group}</div>
                  )}
                  <div
                    id={`${listId}-${options.indexOf(option)}`}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    className={`select-option${option.value === active ? ' select-option-active' : ''}${option.disabled ? ' select-option-disabled' : ''}`}
                    onPointerMove={() => {
                      if (!option.disabled) setActive(option.value);
                    }}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    {option.icon && <span className="select-icon">{option.icon}</span>}
                    <span className="select-option-copy">
                      <span>{option.label}</span>
                      {option.description && <small>{option.description}</small>}
                    </span>
                    {option.value === value && (
                      <Check size={14} className="select-check" aria-hidden="true" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
