export type SelectableOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
};

export function filterSelectOptions<T extends SelectableOption>(
  options: readonly T[],
  query: string,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const text =
      `${option.label} ${option.description ?? ''} ${option.group ?? ''}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function nextSelectOption(
  options: readonly SelectableOption[],
  current: string | null,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): string | null {
  const enabled = options.filter((option) => !option.disabled);
  if (!enabled.length) return null;
  if (key === 'Home') return enabled[0].value;
  if (key === 'End') return enabled[enabled.length - 1].value;
  const index = enabled.findIndex((option) => option.value === current);
  if (index < 0) return enabled[key === 'ArrowDown' ? 0 : enabled.length - 1].value;
  return enabled[(index + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length].value;
}

export function selectPopoverPosition(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  contentHeight: number,
) {
  const margin = 8;
  const gap = 6;
  const width = Math.max(0, Math.min(Math.max(anchor.width, 190), viewport.width - margin * 2));
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const upwards = below < Math.min(contentHeight, 320) && above > below;
  const maxHeight = Math.min(320, upwards ? above : below);
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: upwards
      ? Math.max(margin, anchor.top - gap - Math.min(contentHeight, maxHeight))
      : anchor.bottom + gap,
    width,
    maxHeight,
  };
}

function visible(element: HTMLElement) {
  return (
    element.isConnected &&
    !element.closest('[hidden], [inert]') &&
    element.getClientRects().length > 0
  );
}

/** A portaled selector stays owned by its trigger, including document tabs and dialogs. */
export function mountSelectPopover({
  trigger,
  popover,
  focusTarget,
  onClose,
  onPosition,
}: {
  trigger: HTMLElement;
  popover: HTMLElement;
  focusTarget: HTMLElement;
  onClose: () => void;
  onPosition: () => void;
}) {
  const ownerModal = trigger.closest('[aria-modal="true"]');
  const available = () =>
    visible(trigger) &&
    !trigger.matches(':disabled') &&
    !Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(
      (modal) => modal !== ownerModal && visible(modal) && !modal.contains(trigger),
    );
  if (!available()) {
    onClose();
    return () => {};
  }
  const position = () => {
    if (available()) onPosition();
    else onClose();
  };
  const outside = (event: Event) => {
    if (
      event.target instanceof Node &&
      !popover.contains(event.target) &&
      !trigger.contains(event.target)
    )
      onClose();
  };
  const focusOutside = (event: Event) => {
    if (
      event.target instanceof Node &&
      !popover.contains(event.target) &&
      !trigger.contains(event.target)
    )
      onClose();
  };
  const observer = new MutationObserver(() => {
    if (!available()) onClose();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'inert', 'aria-modal', 'disabled'],
  });
  window.addEventListener('pointerdown', outside);
  window.addEventListener('focusin', focusOutside);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  position();
  // Native pointer activation may focus the trigger after React's layout effects.
  const focusFrame = window.requestAnimationFrame(() => {
    if (available()) focusTarget.focus({ preventScroll: true });
  });
  return () => {
    window.cancelAnimationFrame(focusFrame);
    observer.disconnect();
    window.removeEventListener('pointerdown', outside);
    window.removeEventListener('focusin', focusOutside);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    if (
      available() &&
      (document.activeElement === document.body || popover.contains(document.activeElement))
    )
      trigger.focus({ preventScroll: true });
  };
}
