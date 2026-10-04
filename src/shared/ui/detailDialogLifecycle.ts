/** Portaled editor controls retain the disabled state and visibility of their document owner. */
export function mountDetailDialogOwnership({
  trigger,
  onHide,
  onDisabled,
}: {
  trigger: HTMLElement;
  onHide: () => void;
  onDisabled: (disabled: boolean) => void;
}) {
  const update = () => {
    if (!trigger.isConnected || trigger.closest('[hidden], [inert]')) onHide();
    onDisabled(trigger.matches(':disabled'));
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'inert', 'disabled'],
  });
  return () => observer.disconnect();
}
