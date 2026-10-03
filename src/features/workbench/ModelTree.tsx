import {
  Activity,
  ArrowUpRight,
  Box,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Layers3,
  LockKeyhole,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { Project } from '../../domain/contracts/types';
import type { RegionId } from '../../domain/project/regions';
import { selectionIsCompatible } from '../../domain/project/namedSelections';
import ContextMenu, { type ContextMenuAction } from '../../shared/ui/ContextMenu';
import type { Section } from './navigation';
import './ModelTree.css';

type Props = {
  active?: boolean;
  menusBlocked?: boolean;
  documentId?: string;
  project: Project;
  section: Section;
  constraintId: string | null;
  loadId: string | null;
  namedSelectionId: string | null;
  hasSelection: boolean;
  locked: boolean;
  cells?: number;
  solved: boolean;
  stale: boolean;
  onSection: (section: Section, id?: string) => void;
  onAddSupport: () => void;
  onAddLoad: () => void;
  onAddSelection: () => void;
  onDeleteSupport?: (id: string) => void;
  onDeleteLoad?: (id: string) => void;
  onDeleteSelection?: (id: string) => void;
  onSelectBoundaries?: (regions: RegionId[]) => void;
};
type Target = { section: Section; id?: string; label: string };
type Menu = Target & { x: number; y: number };
type GroupId = 'selections' | 'constraints' | 'loads';

export function revealSelectedModelObject(outline: HTMLElement) {
  const selected = outline.querySelector<HTMLElement>('button[aria-current="page"]');
  if (!selected?.getClientRects().length) return;
  const bounds = outline.getBoundingClientRect();
  const item = selected.getBoundingClientRect();
  if (item.top < bounds.top) outline.scrollTop += item.top - bounds.top;
  else if (item.bottom > bounds.bottom) outline.scrollTop += item.bottom - bounds.bottom;
}

export default function ModelTree(props: Props) {
  const { project, section, onSection } = props;
  const [collapsed, setCollapsed] = useState<Partial<Record<GroupId, boolean>>>({});
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const outline = useRef<HTMLElement | null>(null);
  const menusAvailable = props.active !== false && !props.menusBlocked;
  const is2D = project.study.dimension === '2d';
  useEffect(() => {
    if (!['selections', 'constraints', 'loads'].includes(section)) return;
    setCollapsed((previous) =>
      previous[section as GroupId] ? { ...previous, [section]: false } : previous,
    );
  }, [section, props.constraintId, props.loadId, props.namedSelectionId]);
  useLayoutEffect(() => {
    if (props.active !== false && outline.current) revealSelectedModelObject(outline.current);
  }, [section, props.constraintId, props.loadId, props.namedSelectionId, props.active, collapsed]);
  const resultStatus = props.solved
    ? 'Current solution'
    : props.stale
      ? 'Stale · inputs changed'
      : 'No solution yet';
  const geometryLabel = is2D
    ? project.geometry.kind === 'profile'
      ? 'Line / arc profile'
      : 'Rectangle'
    : project.geometry.kind === 'box'
      ? 'Rectangular solid'
      : project.geometry.kind === 'cylinder'
        ? 'Cylinder'
        : 'L bracket';
  const groupId = (id: GroupId) => `model-${props.documentId ?? project.id}-${id}`;
  const openMenu = (
    target: Target,
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!menusAvailable) return;
    menuTrigger.current =
      event.currentTarget instanceof HTMLButtonElement
        ? event.currentTarget
        : event.currentTarget.querySelector('button');
    const bounds = event.currentTarget.getBoundingClientRect();
    const mouse = 'clientX' in event && event.type === 'contextmenu';
    setMenu({
      ...target,
      x: mouse ? event.clientX : bounds.left + 12,
      y: mouse ? event.clientY : bounds.bottom,
    });
  };
  const contextKeys = (target: Target, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      openMenu(target, event);
  };
  const row = (
    target: Target,
    icon: ReactNode,
    detail?: string,
    child = false,
    current = section === target.section,
  ) => (
    <div
      className={`model-outline-row ${current ? 'active' : ''} ${child ? 'child' : ''}`}
      key={`${target.section}:${target.id ?? ''}`}
      onContextMenu={(event) => openMenu(target, event)}
    >
      <button
        className="model-outline-select"
        aria-current={current ? 'page' : undefined}
        title={detail ? `${target.label} · ${detail}` : target.label}
        onClick={() => onSection(target.section, target.id)}
        onKeyDown={(event) => contextKeys(target, event)}
      >
        {icon}
        <span className="model-outline-copy">
          <span>{target.label}</span>
          {detail && <small>{detail}</small>}
        </span>
        {target.section === 'results' && props.solved && (
          <Check size={13} className="success" aria-label="Current solution" />
        )}
      </button>
      <button
        className="model-outline-more"
        aria-label={`Actions for ${target.label}`}
        aria-haspopup="menu"
        aria-expanded={menu?.section === target.section && menu?.id === target.id}
        title={`Actions for ${target.label}`}
        onClick={(event) => openMenu(target, event)}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
  const group = (
    id: GroupId,
    icon: ReactNode,
    label: string,
    count: number,
    add: () => void,
    addLabel: string,
    addDisabled = props.locked,
  ) => {
    const expanded = !collapsed[id];
    const target = { section: id, label };
    const itemId =
      id === 'constraints'
        ? props.constraintId
        : id === 'loads'
          ? props.loadId
          : props.namedSelectionId;
    return (
      <div
        className={`model-outline-group ${section === id ? 'active' : ''}`}
        onContextMenu={(event) => openMenu(target, event)}
      >
        <button
          className="model-outline-expand"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label.toLowerCase()}`}
          aria-expanded={expanded}
          aria-controls={groupId(id)}
          onClick={() => setCollapsed((previous) => ({ ...previous, [id]: !expanded }))}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          className="model-outline-group-select"
          aria-current={section === id && !itemId ? 'page' : undefined}
          onClick={() => onSection(id)}
          onKeyDown={(event) => contextKeys(target, event)}
        >
          {icon}
          <span>{label}</span>
          <small>{count}</small>
        </button>
        <button
          className="model-outline-add"
          aria-label={addLabel}
          title={addLabel}
          disabled={addDisabled}
          onClick={add}
        >
          <Plus size={14} />
        </button>
      </div>
    );
  };
  const actions: ContextMenuAction[] = menu
    ? [
        {
          label: 'Open properties',
          icon: <SlidersHorizontal size={14} />,
          onSelect: () => onSection(menu.section, menu.id),
        },
      ]
    : [];
  if (menu) {
    const support =
      menu.section === 'constraints'
        ? project.study.constraints.find((item) => item.id === menu.id)
        : undefined;
    const load =
      menu.section === 'loads'
        ? project.study.loads.find((item) => item.id === menu.id)
        : undefined;
    const selection =
      menu.section === 'selections'
        ? project.namedSelections.find((item) => item.id === menu.id)
        : undefined;
    const item = support ?? load ?? selection;
    if (item && props.onSelectBoundaries)
      actions.push({
        label: 'Select assigned boundaries',
        icon: <MousePointer2 size={14} />,
        disabled: !!selection && !selectionIsCompatible(project, selection),
        onSelect: () => props.onSelectBoundaries?.([...item.regions]),
      });
    if (menu.section === 'constraints' || menu.section === 'geometry')
      actions.push({
        label: 'Add support',
        icon: <LockKeyhole size={14} />,
        disabled: props.locked,
        onSelect: props.onAddSupport,
      });
    if (menu.section === 'loads' || menu.section === 'geometry')
      actions.push({
        label: 'Add load',
        icon: <ArrowUpRight size={14} />,
        disabled: props.locked,
        onSelect: props.onAddLoad,
      });
    if (menu.section === 'selections' || menu.section === 'geometry')
      actions.push({
        label: 'Save selected boundaries',
        icon: <Bookmark size={14} />,
        disabled: props.locked || !props.hasSelection || project.namedSelections.length >= 100,
        onSelect: props.onAddSelection,
      });
    const remove = support
      ? props.onDeleteSupport
      : load
        ? props.onDeleteLoad
        : selection
          ? props.onDeleteSelection
          : undefined;
    if (item && remove)
      actions.push({
        label: support ? 'Delete support' : load ? 'Delete load' : 'Delete boundary set',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: props.locked,
        onSelect: () => remove(item.id),
      });
  }
  return (
    <>
      <div className="panel-heading model-outline-heading">
        <span>Model</span>
        <small>{is2D ? '2D' : '3D'} · Static structural</small>
      </div>
      <nav ref={outline} className="model-tree model-outline" aria-label="Model objects">
        {row({ section: 'study', label: project.name }, <Activity size={15} />, 'Study definition')}
        {row({ section: 'geometry', label: 'Geometry' }, <Box size={15} />, geometryLabel)}
        {row(
          { section: 'material', label: 'Material' },
          <Layers3 size={15} />,
          project.study.material.name,
        )}
        <div className="model-outline-category">Boundary conditions</div>
        {group(
          'selections',
          <Bookmark size={14} />,
          'Boundary sets',
          project.namedSelections.length,
          props.onAddSelection,
          'Save selected boundaries',
          props.locked || !props.hasSelection || project.namedSelections.length >= 100,
        )}
        <div id={groupId('selections')} hidden={collapsed.selections}>
          {project.namedSelections.map((item) =>
            row(
              { section: 'selections', id: item.id, label: item.name },
              <Bookmark size={12} />,
              selectionIsCompatible(project, item) ? undefined : 'Repair required',
              true,
              section === 'selections' && props.namedSelectionId === item.id,
            ),
          )}
        </div>
        {group(
          'constraints',
          <LockKeyhole size={14} />,
          'Supports',
          project.study.constraints.length,
          props.onAddSupport,
          'Add support',
        )}
        <div id={groupId('constraints')} hidden={collapsed.constraints}>
          {project.study.constraints.map((item) =>
            row(
              { section: 'constraints', id: item.id, label: item.name },
              <LockKeyhole size={12} />,
              undefined,
              true,
              section === 'constraints' && props.constraintId === item.id,
            ),
          )}
        </div>
        {group(
          'loads',
          <ArrowUpRight size={14} />,
          'Loads',
          project.study.loads.length,
          props.onAddLoad,
          'Add load',
        )}
        <div id={groupId('loads')} hidden={collapsed.loads}>
          {project.study.loads.map((item) =>
            row(
              { section: 'loads', id: item.id, label: item.name },
              <ArrowUpRight size={12} />,
              undefined,
              true,
              section === 'loads' && props.loadId === item.id,
            ),
          )}
        </div>
        <div className="model-outline-category">Analysis</div>
        {row(
          { section: 'mesh', label: 'Mesh' },
          <Magnet size={15} />,
          props.cells
            ? `${props.cells.toLocaleString()} ${is2D ? 'triangles' : 'tetrahedra'}`
            : undefined,
        )}
        {row(
          { section: 'solver', label: 'Method' },
          <Settings2 size={15} />,
          project.study.solver.kind === 'pinn' ? 'PINN · experimental' : 'Finite element method',
        )}
        {row({ section: 'results', label: 'Results' }, <Activity size={15} />, resultStatus)}
      </nav>
      <div className="model-outline-hint">Select an object to edit · Right-click for actions</div>
      {menu && (
        <ContextMenu
          label={`${menu.label} actions`}
          x={menu.x}
          y={menu.y}
          actions={actions}
          restoreFocus={menuTrigger.current}
          available={menusAvailable}
          fallbackFocus={() =>
            outline.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
            outline.current?.querySelector<HTMLElement>('button:not(:disabled)') ??
            null
          }
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
