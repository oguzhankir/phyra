import { useEffect, useRef, type RefObject } from 'react';
export function useModalFocus(
  open: boolean,
  onEscape: () => void,
  identity: string | null = null,
  modalRef?: RefObject<HTMLElement | null>,
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const modal =
      modalRef?.current ??
      Array.from(document.querySelectorAll<HTMLElement>('.modal'))
        .reverse()
        .find((element) => element.getClientRects().length > 0);
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    const firstInput = focusable().find((element) => element.tagName === 'INPUT');
    (firstInput ?? focusable()[0])?.focus();
    const key = (event: KeyboardEvent) => {
      // Portaled controls own their keys before the containing dialog sees them.
      if (
        event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest('[data-ui-overlay]'))
      )
        return;
      const topModal = Array.from(document.querySelectorAll<HTMLElement>('.modal'))
        .reverse()
        .find((element) => element.getClientRects().length > 0);
      if (topModal !== modal) return;
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
  }, [open, identity, modalRef]);
}
