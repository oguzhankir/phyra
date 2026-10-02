import { useEffect, useRef } from 'react';
export function useModalFocus(open: boolean, onEscape: () => void, identity: string | null = null) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const modal = document.querySelector<HTMLElement>('.modal');
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    (modal?.querySelector<HTMLInputElement>('input') ?? focusable()[0])?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
      }
      const buttons = focusable();
      if (event.key === 'Tab' && buttons.length) {
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? index <= 0
            ? buttons.length - 1
            : index - 1
          : (index + 1) % buttons.length;
        event.preventDefault();
        buttons[next].focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        !previous.matches(':disabled') &&
        previous.getClientRects().length > 0
      )
        previous.focus();
      else document.querySelector<HTMLElement>('[data-modal-focus-fallback]')?.focus();
    };
  }, [open, identity]);
}
