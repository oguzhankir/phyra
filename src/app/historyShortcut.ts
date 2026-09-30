type ShortcutEvent = Pick<
  KeyboardEvent,
  | 'key'
  | 'metaKey'
  | 'ctrlKey'
  | 'altKey'
  | 'shiftKey'
  | 'isComposing'
  | 'defaultPrevented'
  | 'target'
>;
type Circumstances = {
  readonly platform: 'mac' | 'windows' | 'other';
  readonly blocked: boolean;
};

function editsText(target: EventTarget | null): boolean {
  let node = target;
  // Keyboard events normally target an Element. Structural checks also keep
  // the pure shortcut decision independent of a global browser constructor.
  while (node && 'tagName' in node && 'getAttribute' in node) {
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return true;
    const role = element.getAttribute('role');
    if (role?.split(/\s+/).includes('textbox')) return true;
    const editable = element.getAttribute('contenteditable');
    if (editable !== null && editable.toLowerCase() !== 'false') return true;
    node = element.parentElement;
  }
  return false;
}

// Model history never consumes an active text editor's own undo stack.
export function historyShortcut(
  event: ShortcutEvent,
  { platform, blocked }: Circumstances,
): 'undo' | 'redo' | null {
  if (
    blocked ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    (event.metaKey && event.ctrlKey) ||
    editsText(event.target)
  )
    return null;
  const modifier =
    platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (platform === 'windows' && key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
