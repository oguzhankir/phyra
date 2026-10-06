import type { Dispatch, RefObject, SetStateAction } from 'react';
import type {
  Constraint,
  Devices,
  Load,
  Manifest,
  Operation,
  Project,
} from '../../domain/contracts/types';
import type { RegionId } from '../../domain/project/regions';
import type { NamedSelection } from '../../domain/project/namedSelections';
import type { FieldId, ResultData } from '../../domain/results/fields';
import type { Probe } from '../../domain/results/probe';
import type { Section } from '../workbench/navigation';
import type { HelpContext } from '../help/content';
type Setter<T> = Dispatch<SetStateAction<T>>;
// The inspector consumes a domain definition and explicit edit/view actions, never application lifecycle internals.
export interface ProjectInspectorModel {
  sketchTarget?: HTMLElement | null;
  sourceCad?: boolean;
  openCad?: () => void;
  reportDraftValidity?: (id: string, label: string | null) => void;
  section: Section;
  showHelp: (context?: HelpContext) => void;
  locked: boolean;
  project: Project;
  namedSelectionId: string | null;
  namedSelection: NamedSelection | undefined;
  addNamedSelection: () => void;
  editNamedSelection: (change: (item: NamedSelection) => void) => void;
  useNamedSelection: (item: NamedSelection) => void;
  setNamedSelectionId: Setter<string | null>;
  setNotice: (value: string | null) => void;
  edit: (change: (next: Project) => void, physical?: boolean) => void;
  is2D: boolean;
  chooseDimension: (dimension: Project['study']['dimension']) => void;
  factor: number;
  selectSection: (next: Section, id?: string) => void;
  isPinn: boolean;
  devices: Devices | null;
  desktop: boolean;
  refreshDevices: () => Promise<void>;
  deviceBusy: boolean;
  deviceError: string | null;
  validation: string | null;
  execute: (operation: Operation) => Promise<void>;
  invalidDraftsRef: RefObject<Map<string, string>>;
  setError: (value: string | null) => void;
  setSelected: Setter<RegionId[]>;
  setConstraintId: Setter<string | null>;
  setLoadId: Setter<string | null>;
  regions: { id: RegionId; name: string }[];
  selected: RegionId[];
  selectRegion: (region: RegionId) => void;
  stat: Manifest['statistics'] | undefined;
  addConstraint: () => void;
  constraint: Constraint | undefined;
  editConstraint: (change: (item: Constraint) => void) => void;
  addLoad: () => void;
  load: Load | undefined;
  editLoad: (change: (item: Load) => void) => void;
  solved: boolean;
  data: ResultData | null;
  fieldId: FieldId;
  setFieldId: Setter<FieldId>;
  setProbe: Setter<Probe | null>;
  availableFields: { id: FieldId; label: string }[];
  deformation: 'off' | 'actual' | 'auto' | 'custom';
  setDeformation: Setter<'off' | 'actual' | 'auto' | 'custom'>;
  customScale: number;
  setCustomScale: Setter<number>;
  animate: boolean;
  setAnimate: Setter<boolean>;
  probe: Probe | null;
  currentData: ResultData | null;
  exportFields: () => Promise<void>;
  fileBusy: string | null;
  busy: Operation | null;
}
