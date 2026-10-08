import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import Menu from '../../shared/ui/Menu';

export interface CadToolAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  reason?: string;
  run: () => void;
}

function Action({ action, menu = false }: { action: CadToolAction; menu?: boolean }) {
  const Icon = action.icon;
  return (
    <button
      role={menu ? 'menuitem' : undefined}
      disabled={action.disabled}
      title={action.reason}
      onClick={action.run}
    >
      {Icon && <Icon size={15} aria-hidden="true" />}
      <span>{action.label}</span>
      {menu && action.reason && <small>{action.reason}</small>}
    </button>
  );
}

/** Compact discovery groups share action callbacks with the workspace's command lifecycle. */
export default function CadToolbar({
  navigatorOpen,
  onToggleNavigator,
  primary,
  create,
  modify,
  inspect,
  importAction,
  conversion,
  leading,
  trailing,
  modifySettings,
}: {
  navigatorOpen: boolean;
  onToggleNavigator: () => void;
  primary: CadToolAction[];
  create: CadToolAction[];
  modify: CadToolAction[];
  inspect: CadToolAction[];
  importAction: CadToolAction;
  conversion?: CadToolAction | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  modifySettings?: ReactNode;
}) {
  const NavigatorIcon = navigatorOpen ? PanelLeftClose : PanelLeft;
  return (
    <div className="cad-ribbon cad-command-strip" role="toolbar" aria-label="CAD feature tools">
      {leading}
      <button
        className="icon-button"
        aria-label={navigatorOpen ? 'Hide model navigator' : 'Show model navigator'}
        aria-expanded={navigatorOpen}
        aria-controls="cad-model-navigator"
        onClick={onToggleNavigator}
      >
        <NavigatorIcon size={16} />
      </button>
      <div className="cad-tool-group" aria-label="Sketch and extrusion">
        {primary.map((action) => (
          <Action key={action.id} action={action} />
        ))}
      </div>
      <div className="cad-tool-group">
        <Menu label="Create" className="cad-tool-menu" width={290}>
          {conversion && <Action action={conversion} menu />}
          {create.map((action) => (
            <Action key={action.id} action={action} menu />
          ))}
          <div className="menu-divider" />
          <Action action={importAction} menu />
        </Menu>
        <Menu label="Modify" className="cad-tool-menu" width={290}>
          {modify.map((action) => (
            <Action key={action.id} action={action} menu />
          ))}
          {modifySettings}
        </Menu>
      </div>
      <div className="cad-tool-group cad-tool-group-utilities">
        <Menu label="Inspect" className="cad-tool-menu" width={270}>
          {inspect.map((action) => (
            <Action key={action.id} action={action} menu />
          ))}
        </Menu>
      </div>
      {trailing}
    </div>
  );
}
