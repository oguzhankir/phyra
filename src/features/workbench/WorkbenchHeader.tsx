import { version } from '../../../package.json';
import {
  Check,
  FilePlus2,
  FolderOpen,
  Sparkles,
  Redo2,
  Save,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import phyraLogo from '../../../assets/phyra.svg';
import type { ThemePreference } from './theme';
import Menu from '../../shared/ui/Menu';

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
  return (
    <header className="app-header">
      <div className="brand" aria-label="Phyra engineering workbench">
        <img src={phyraLogo} alt="" />
        <strong>Phyra</strong>
        <span className="brand-version" title="Application version">
          {version}
        </span>
      </div>
      <div className="app-menus">
        <Menu label="File">
          <button role="menuitem" disabled={props.locked} onClick={props.onNew}>
            <FilePlus2 size={15} />
            New project<kbd>⌘/Ctrl N</kbd>
          </button>
          <button
            role="menuitem"
            disabled={props.locked || !props.canUseFiles}
            onClick={props.onOpen}
          >
            <FolderOpen size={15} />
            Open project…<kbd>⌘/Ctrl O</kbd>
          </button>
          <div className="menu-divider" />
          <button role="menuitem" disabled={!props.canSave} onClick={() => props.onSave()}>
            <Save size={15} />
            Save<kbd>⌘/Ctrl S</kbd>
          </button>
          <button role="menuitem" disabled={!props.canSave} onClick={() => props.onSave(true)}>
            <span className="menu-icon" />
            Save as…<kbd>⇧ ⌘/Ctrl S</kbd>
          </button>
          <button
            role="menuitem"
            disabled={!props.hasProject || !props.canClose}
            onClick={props.onClose}
          >
            <X size={15} /> Close project<kbd>⌘/Ctrl W</kbd>
          </button>
          <div className="menu-divider" />
          <button role="menuitem" disabled={!props.canExport} onClick={props.onExport}>
            <span className="menu-icon" />
            Export physical fields…
          </button>
        </Menu>
        <Menu label="Edit">
          <button role="menuitem" disabled={!props.canUndo} onClick={props.onUndo}>
            <Undo2 size={15} />
            Undo {props.undoLabel}
            <kbd>⌘/Ctrl Z</kbd>
          </button>
          <button role="menuitem" disabled={!props.canRedo} onClick={props.onRedo}>
            <Redo2 size={15} />
            Redo {props.redoLabel}
            <kbd>⇧ ⌘/Ctrl Z</kbd>
          </button>
        </Menu>
        <Menu label="View" className="theme-menu" width={220}>
          <span className="menu-label">Appearance</span>
          {(['light', 'dark', 'system'] as const).map((theme) => (
            <button
              role="menuitemradio"
              key={theme}
              aria-checked={props.preference === theme}
              onClick={() => props.onTheme(theme)}
            >
              {props.preference === theme ? <Check size={15} /> : <span className="menu-icon" />}
              {theme === 'system'
                ? 'Use system theme'
                : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}
            </button>
          ))}
        </Menu>
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
            title="Open AI assistant · Ctrl/⌘ J"
            aria-label="Open AI assistant"
            onClick={() => props.onAssistantOpen?.()}
          >
            <Sparkles size={18} aria-hidden="true" />
            <span>AI assistant</span>
          </button>
        )}
      </div>
    </header>
  );
}
