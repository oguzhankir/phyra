import { version } from '../../../package.json';
import { useEffect, useRef } from 'react';
import {
  Check,
  ChevronDown,
  CircleHelp,
  FilePlus2,
  FolderOpen,
  Moon,
  Save,
  Sun,
} from 'lucide-react';
import phyraLogo from '../../../assets/phyra.svg';
import type { Theme, ThemePreference } from './theme';

type Props = {
  name: string;
  path: string | null;
  dirty: boolean;
  locked: boolean;
  canUseFiles: boolean;
  canSave: boolean;
  canExport: boolean;
  device: string;
  theme: Theme;
  preference: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: (saveAs?: boolean) => void;
  onExport: () => void;
  onHelp: () => void;
  onFilesHelp: () => void;
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
            <div className="menu-divider" />
            <button disabled={!props.canExport} onClick={() => action(props.onExport)}>
              <span className="menu-icon" />
              Export physical fields…
            </button>
            <button onClick={() => action(props.onFilesHelp)}>
              <CircleHelp size={15} />
              Project file help
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
        <button className="menu-help" onClick={props.onHelp}>
          Help
        </button>
      </div>
      <div className="project-title" title={props.path ?? props.name}>
        <strong>{props.name}</strong>
        {props.dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
        <span>{props.path ? props.path.split(/[\\/]/).pop() : 'Unsaved local project'}</span>
      </div>
      <div className="header-end">
        <span className="device-badge" title="Local execution device">
          {props.device}
        </span>
        <div className="file-actions">
          <button
            title="New project · Ctrl/⌘ N"
            aria-label="New project"
            disabled={props.locked}
            onClick={props.onNew}
          >
            <FilePlus2 size={17} />
          </button>
          <button
            title="Open project · Ctrl/⌘ O"
            aria-label="Open project"
            disabled={props.locked || !props.canUseFiles}
            onClick={props.onOpen}
          >
            <FolderOpen size={17} />
          </button>
          <button
            title="Save project · Ctrl/⌘ S"
            aria-label="Save project"
            disabled={!props.canSave}
            onClick={() => props.onSave()}
          >
            <Save size={17} />
          </button>
        </div>
        <button
          title={`Switch to ${props.theme === 'light' ? 'dark' : 'light'} theme`}
          aria-label={`Switch to ${props.theme === 'light' ? 'dark' : 'light'} theme`}
          onClick={() => props.onTheme(props.theme === 'light' ? 'dark' : 'light')}
        >
          {props.theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>
        <button
          title="Contextual help · F1"
          aria-label="Open contextual help"
          onClick={props.onHelp}
        >
          <CircleHelp size={18} />
        </button>
      </div>
    </header>
  );
}
