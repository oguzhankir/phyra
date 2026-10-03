type MenuLifecycle = {
  available: boolean;
  element: HTMLElement | null;
  onClose: () => void;
  canRestoreFocus: () => boolean;
  restoreFocus?: HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
};

function modalIsVisible() {
  return Array.from(document.querySelectorAll<HTMLElement>('.modal[aria-modal="true"]')).some(
    (element) => element.getClientRects().length > 0,
  );
}

function canFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return !!(
    element?.isConnected &&
    !element.matches(':disabled') &&
    !element.closest('[inert]') &&
    element.getClientRects().length
  );
}

/** Portaled menus lose their scope when their document or a dialog takes over. */
export function mountContextMenuLifecycle(options: MenuLifecycle): () => void {
  const { element, onClose } = options;
  if (!options.available || modalIsVisible()) {
    onClose();
    return () => {};
  }
  if (!element) return () => {};
  element.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  const outside = (event: Event) => {
    if (event.target instanceof Node && !element.contains(event.target)) onClose();
  };
  const modal = new MutationObserver(() => {
    if (modalIsVisible()) onClose();
  });
  // Some dialogs (including the expanded sketch) own their state below the workspace.
  modal.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-modal', 'hidden'],
  });
  window.addEventListener('pointerdown', outside);
  window.addEventListener('resize', onClose);
  return () => {
    window.removeEventListener('pointerdown', outside);
    window.removeEventListener('resize', onClose);
    modal.disconnect();
    const restore = () => {
      if (!options.canRestoreFocus() || modalIsVisible()) return;
      if (document.activeElement !== document.body && !element.contains(document.activeElement))
        return;
      const target = canFocus(options.restoreFocus)
        ? options.restoreFocus
        : options.fallbackFocus?.();
      if (canFocus(target)) target.focus();
    };
    restore();
    // A delete action may remove the trigger in the same React commit as this menu.
    // Resolve the current object again after those DOM removals have finished.
    queueMicrotask(restore);
  };
}
