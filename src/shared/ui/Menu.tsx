import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { mountSelectPopover, selectPopoverPosition } from './selectPopover';

/** An application menu, sharing document and focus ownership with other popovers. */
export default function Menu({
  label,
  children,
  className = '',
  width = 295,
  triggerContent,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  width?: number;
  triggerContent?: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width, maxHeight: 320 });
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const element = popup.current;
    return mountSelectPopover({
      trigger: trigger.current,
      popover: element,
      focusTarget: element.querySelector<HTMLElement>('button:not(:disabled)') ?? element,
      onClose: () => setOpen(false),
      onPosition: () => {
        if (!trigger.current) return;
        setPosition(
          selectPopoverPosition(
            { ...trigger.current.getBoundingClientRect().toJSON(), width },
            { width: window.innerWidth, height: window.innerHeight },
            element.scrollHeight,
          ),
        );
      },
    });
  }, [open, width]);
  return (
    <>
      <button
        ref={trigger}
        className="app-menu-trigger"
        aria-haspopup="menu"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerContent ?? label}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="menu"
            tabIndex={-1}
            aria-label={label}
            data-ui-overlay
            className={`menu-popover ${className}`}
            style={position}
            onClick={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest('button:not(:disabled)')
              ) {
                if (popup.current?.contains(document.activeElement)) trigger.current?.focus();
                setOpen(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault();
                event.stopPropagation();
                trigger.current?.focus();
                setOpen(false);
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const buttons = Array.from(
                popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
              );
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
