import {
  ArrowUpRight,
  BookmarkPlus,
  Box,
  Eye,
  Focus,
  LockKeyhole,
  Maximize,
  RotateCcw,
} from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../../shared/ui/ContextMenu';
import type { Project } from '../../domain/contracts/types';
import type { RegionId } from '../../domain/project/regions';

export type ViewportMenuContext = {
  x: number;
  y: number;
  regions: RegionId[];
  restoreFocus: HTMLElement | null;
};
type Props = {
  context: ViewportMenuContext;
  label: string;
  project: Project;
  locked?: boolean;
  isolated: boolean;
  onEditGeometry?: () => void;
  onAddCondition?: (kind: 'constraint' | 'load', regions: RegionId[]) => void;
  onAddNamedSelection?: (regions: RegionId[]) => void;
  onCondition?: (kind: 'constraint' | 'load', id: string) => void;
  onFitSelection: (regions: RegionId[]) => void;
  onIsolate: (regions: RegionId[]) => void;
  onRestore: () => void;
  onFit: () => void;
  onReset: () => void;
  onClearSelection?: () => void;
  onClose: () => void;
};

/** Presentation actions stay local; definition edits use explicit injected transactions. */
export default function ViewportMenu(props: Props) {
  const regions = props.context.regions;
  const cannotAssign = props.locked || !regions.length;
  const actions: ContextMenuAction[] = [
    ...(props.onEditGeometry
      ? [
          {
            id: 'geometry',
            label: 'Edit geometry',
            icon: <Box size={15} />,
            onSelect: props.onEditGeometry,
          },
        ]
      : []),
    ...(props.onAddCondition
      ? [
          {
            id: 'support',
            label: 'Add support to selection…',
            icon: <LockKeyhole size={15} />,
            disabled: cannotAssign,
            onSelect: () => props.onAddCondition?.('constraint', regions),
          },
          {
            id: 'load',
            label: 'Add load to selection…',
            icon: <ArrowUpRight size={15} />,
            disabled: cannotAssign,
            onSelect: () => props.onAddCondition?.('load', regions),
          },
        ]
      : []),
    ...(props.onAddNamedSelection
      ? [
          {
            id: 'named-boundary',
            label: 'Name selected boundaries…',
            icon: <BookmarkPlus size={15} />,
            disabled: cannotAssign,
            onSelect: () => props.onAddNamedSelection?.(regions),
          },
        ]
      : []),
    ...[
      ...props.project.study.constraints.map((item) => ({ item, kind: 'constraint' as const })),
      ...props.project.study.loads.map((item) => ({ item, kind: 'load' as const })),
    ]
      .filter(({ item }) => item.regions.some((region) => regions.includes(region)))
      .map(({ item, kind }) => ({
        id: `${kind}:${item.id}`,
        label: `Edit ${item.name}…`,
        onSelect: () => props.onCondition?.(kind, item.id),
        disabled: !props.onCondition,
      })),
    {
      id: 'fit-selection',
      label: 'Fit selection',
      icon: <Focus size={15} />,
      disabled: !regions.length,
      onSelect: () => props.onFitSelection(regions),
    },
    {
      id: 'isolate',
      label: 'Isolate selected boundaries',
      disabled: !regions.length,
      onSelect: () => props.onIsolate(regions),
    },
    ...(props.isolated
      ? [
          {
            id: 'restore',
            label: 'Show all boundaries',
            icon: <Eye size={15} />,
            onSelect: props.onRestore,
          },
        ]
      : []),
    { id: 'fit-model', label: 'Fit model', icon: <Maximize size={15} />, onSelect: props.onFit },
    { id: 'reset', label: 'Reset camera', icon: <RotateCcw size={15} />, onSelect: props.onReset },
    {
      id: 'clear',
      label: 'Clear boundary selection',
      disabled: !regions.length || !props.onClearSelection,
      onSelect: () => props.onClearSelection?.(),
    },
  ];
  return (
    <ContextMenu
      label={props.label}
      x={props.context.x}
      y={props.context.y}
      restoreFocus={props.context.restoreFocus}
      actions={actions}
      onClose={props.onClose}
    />
  );
}
