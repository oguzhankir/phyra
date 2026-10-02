import { version } from '../../../package.json';
import { useEffect, useRef } from 'react';
import {
  Check,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  MessageCircle,
  Redo2,
  Save,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import phyraLogo from '../../../assets/phyra.svg';
import type { ThemePreference } from './theme';

type Props = {
  hasProject: boolean;
  canClose: boolean;
  locked: boolean;
  canUseFiles: boolean;
  canSave: boolean;
  canExport: boolean;
  preference: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  onNew: () => void;
  onOpen: () => void;
  onClose: () => void;
  onSave: (saveAs?: boolean) => void;
  onExport: () => void;
  onHelp: () => void;
  onFilesHelp: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
  onCommands?: () => void;
  onAssistantOpen?: () => void;
};

export default function WorkbenchHeader(props: Props) {
  const menus = useRef<HTMLDivElement>(null);
  const closeMenus = () => {
    menus.current?.querySelectorAll('details').forEach((menu) => (menu.open = false));
  };
  const action = (callback: () => void) => {
    // A menu item becomes hidden after its disclosure closes.
    // Remember the visible menu trigger as the next dialog's return focus.
    menus.current?.querySelector<HTMLElement>('details[open] summary')?.focus();
    closeMenus();
    callback();
  };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menus.current?.contains(event.target as Node)) closeMenus();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const opened = menus.current?.querySelector<HTMLDetailsElement>('details[open]');
      opened?.querySelector('summary')?.focus();
      closeMenus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <header className="app-header">
      <div className="brand" aria-label="Phyra engineering workbench">
        <img src={phyraLogo} alt="" />
        <strong>Phyra</strong>
        <span className="brand-version" title="Application version">
          {version}
        </span>
      </div>
      <div className="app-menus" ref={menus}>
        <details
          onToggle={(event) => {
            if (event.currentTarget.open)
              menus.current?.querySelectorAll('details').forEach((menu) => {
                if (menu !== event.currentTarget) menu.open = false;
              });
          }}
        >
          <summary>
            File <ChevronDown size={11} />
          </summary>
          <div className="menu-popover">
            <button disabled={props.locked} onClick={() => action(props.onNew)}>
              <FilePlus2 size={15} />
              New project<kbd>⌘/Ctrl N</kbd>
            </button>
            <button
              disabled={props.locked || !props.canUseFiles}
              onClick={() => action(props.onOpen)}
            >
              <FolderOpen size={15} />
              Open project…<kbd>⌘/Ctrl O</kbd>
            </button>
            <div className="menu-divider" />
            <button disabled={!props.canSave} onClick={() => action(() => props.onSave())}>
              <Save size={15} />
              Save<kbd>⌘/Ctrl S</kbd>
            </button>
            <button disabled={!props.canSave} onClick={() => action(() => props.onSave(true))}>
              <span className="menu-icon" />
              Save as…<kbd>⇧ ⌘/Ctrl S</kbd>
            </button>
            <button
              disabled={!props.hasProject || !props.canClose}
              onClick={() => action(props.onClose)}
            >
              <X size={15} /> Close project<kbd>⌘/Ctrl W</kbd>
            </button>
            <div className="menu-divider" />
            <button disabled={!props.canExport} onClick={() => action(props.onExport)}>
              <span className="menu-icon" />
              Export physical fields…
            </button>
          </div>
        </details>
        <details
          onToggle={(event) => {
            if (event.currentTarget.open)
              menus.current?.querySelectorAll('details').forEach((menu) => {
                if (menu !== event.currentTarget) menu.open = false;
              });
          }}
        >
          <summary>
            Edit <ChevronDown size={11} />
          </summary>
          <div className="menu-popover">
            <button disabled={!props.canUndo} onClick={() => action(props.onUndo)}>
              <Undo2 size={15} />
              Undo {props.undoLabel}
              <kbd>⌘/Ctrl Z</kbd>
            </button>
            <button disabled={!props.canRedo} onClick={() => action(props.onRedo)}>
              <Redo2 size={15} />
              Redo {props.redoLabel}
              <kbd>⇧ ⌘/Ctrl Z</kbd>
            </button>
          </div>
        </details>
        <details
          onToggle={(event) => {
            if (event.currentTarget.open)
              menus.current?.querySelectorAll('details').forEach((menu) => {
                if (menu !== event.currentTarget) menu.open = false;
              });
          }}
        >
          <summary>
            View <ChevronDown size={11} />
          </summary>
          <div className="menu-popover theme-menu">
            <span className="menu-label">Appearance</span>
            {(['light', 'dark', 'system'] as const).map((theme) => (
              <button
                key={theme}
                aria-pressed={props.preference === theme}
                onClick={() => action(() => props.onTheme(theme))}
              >
                {props.preference === theme ? <Check size={15} /> : <span className="menu-icon" />}
                {theme === 'system'
                  ? 'Use system theme'
                  : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}
              </button>
            ))}
          </div>
        </details>
        <button
          className="menu-help"
          title="Workbench help · F1"
          aria-label="Open workbench help"
          onClick={props.onHelp}
        >
          Help
        </button>
      </div>
      <div className="header-end">
        {props.onCommands && (
          <button
            className="command-trigger"
            data-modal-focus-fallback
            title="Search actions and editors · Ctrl/⌘ K"
            aria-label="Search actions and editors"
            onClick={props.onCommands}
          >
            <Search size={15} />
            <span>Search actions</span>
            <kbd>⌘/Ctrl K</kbd>
          </button>
        )}
        {props.onAssistantOpen && (
          <button
            className="assistant-launcher"
            title="Open chat · Ctrl/⌘ J"
            aria-label="Open AI assistant"
            onClick={() => props.onAssistantOpen?.()}
          >
            <MessageCircle size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
