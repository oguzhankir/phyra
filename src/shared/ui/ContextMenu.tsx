import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { mountContextMenuLifecycle } from './contextMenuLifecycle';
import './ContextMenu.css';

export type ContextMenuAction = {
  id?: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export default function ContextMenu({
  label,
  x,
  y,
  actions,
  onClose,
  restoreFocus,
  fallbackFocus,
  available = true,
}: {
  label: string;
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
  restoreFocus?: HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
  available?: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const availableRef = useRef(available);
  availableRef.current = available;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const element = menu.current;
    if (element && available) {
      const bounds = element.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
      });
    }
    return mountContextMenuLifecycle({
      element,
      available,
      onClose: () => closeRef.current(),
      canRestoreFocus: () => availableRef.current,
      restoreFocus,
      fallbackFocus: () => fallbackRef.current?.() ?? null,
    });
  }, [x, y, restoreFocus, available]);
  if (!available) return null;
  return createPortal(
    <div
      ref={menu}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
        );
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}
    >
      <div className="context-menu-title">{label}</div>
      {actions.map((action, index) => (
        <button
          key={action.id ?? `${action.label}:${index}`}
          role="menuitem"
          className={action.danger ? 'context-menu-danger' : undefined}
          disabled={action.disabled}
          onClick={() => {
            if (!availableRef.current) return;
            onClose();
            action.onSelect();
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
