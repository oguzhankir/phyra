import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Project } from '../domain/contracts/types';
import type { RegionId } from '../domain/project/regions';
import {
  extractField,
  fieldOptions,
  type FieldId,
  type FieldSource,
  type ResultData,
} from '../domain/results/fields';
import type { Probe } from '../domain/results/probe';
import type { HelpContext } from '../features/help/content';
import type { Section } from '../features/workbench/navigation';
import type { SelectionMode } from '../features/viewport/selection';
import { selectionIsCompatible } from '../domain/project/namedSelections';
import type { useTheme } from '../features/workbench/theme';

interface Props {
  appearance: ReturnType<typeof useTheme>;
  project: Project;
  currentData: ResultData | null;
  invalidDraftsRef: RefObject<Map<string, string>>;
  onError: (message: string | null) => void;
}

// Presentation state only: navigation, selection, field display and pane layout.
// Authoritative definitions and numerical fields belong to their session owners.
export function useWorkbenchView({
  project,
  currentData,
  invalidDraftsRef,
  onError,
  appearance,
}: Props) {
  const is2D = project.study.dimension === '2d';
  const [section, setSection] = useState<Section>('study');
  const [selected, setSelected] = useState<RegionId[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('replace');
  const [constraintId, setConstraintId] = useState<string | null>(null);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [namedSelectionId, setNamedSelectionId] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<FieldId>(() =>
    currentData && currentData.manifest.operation !== 'mesh' ? 'displacement-mag' : 'geometry',
  );
  const [edges, setEdges] = useState(true);
  const [deformation, setDeformation] = useState<'off' | 'actual' | 'auto' | 'custom'>('auto');
  const [customScale, setCustomScale] = useState(10);
  const [animate, setAnimate] = useState(false);
  const [fieldSource, setFieldSource] = useState<FieldSource>('primary');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [leftWidth, setLeftWidth] = useState(350);
  const [help, setHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<HelpContext>('overview');
  const { theme, preference, setPreference } = appearance;
  const showHelp = (context: HelpContext = section) => {
    setHelpContext(context);
    setHelp(true);
  };
  const field = useMemo(
    () => extractField(currentData, fieldId, fieldSource),
    [currentData, fieldId, fieldSource],
  );
  const availableFields = fieldOptions.filter(
    (option) =>
      (!is2D ||
        !['displacement-z', 'stress-zz', 'stress-yz', 'stress-xz', 'reactions-z'].includes(
          option.id,
        )) &&
      (!option.id.startsWith('reactions') ||
        (currentData?.manifest.arrays.reactions &&
          fieldSource !== 'pinn' &&
          fieldSource !== 'difference' &&
          fieldSource !== 'relative')),
  );
  const reset = (result: ResultData | null) => {
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
    setNamedSelectionId(null);
    setSection('study');
    setAnimate(false);
    setFieldSource('primary');
    setFieldId(result && result.manifest.operation !== 'mesh' ? 'displacement-mag' : 'geometry');
    setProbe(null);
  };
  const panelWidth = (value: number) =>
    Math.max(300, Math.min(520, window.innerWidth - 370, value));
  const adjustPanel = (delta: number) => setLeftWidth((width) => panelWidth(width + delta));
  useEffect(() => {
    const fitPanel = () => setLeftWidth((width) => panelWidth(width));
    window.addEventListener('resize', fitPanel);
    return () => window.removeEventListener('resize', fitPanel);
  }, []);
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = event.clientX;
    const width = leftWidth;
    const move = (pointer: PointerEvent) =>
      setLeftWidth(panelWidth(width + pointer.clientX - start));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  const selectRegion = (region: RegionId) =>
    setSelected((previous) =>
      previous.includes(region)
        ? previous.filter((item) => item !== region)
        : [...previous, region],
    );
  const selectSection = (next: Section, id?: string) => {
    if (
      invalidDraftsRef.current.size &&
      (next !== section ||
        (next === 'constraints' && id !== constraintId) ||
        (next === 'loads' && id !== loadId) ||
        (next === 'selections' && id !== namedSelectionId))
    ) {
      onError('Complete the numeric input, or press Escape to revert it before changing editors.');
      return;
    }
    setSection(next);
    if (next === 'constraints' && id) {
      setConstraintId(id);
      setSelected(project.study.constraints.find((item) => item.id === id)?.regions ?? []);
    }
    if (next === 'loads' && id) {
      setLoadId(id);
      setSelected(project.study.loads.find((item) => item.id === id)?.regions ?? []);
    }
    if (next === 'selections' && id) {
      setNamedSelectionId(id);
      const item = project.namedSelections.find((candidate) => candidate.id === id);
      setSelected(item && selectionIsCompatible(project, item) ? [...item.regions] : []);
    }
  };
  const chooseSource = (source: FieldSource) => {
    setFieldSource(source);
    setProbe(null);
    if (source !== 'fem' && source !== 'primary' && fieldId.startsWith('reactions'))
      setFieldId('displacement-mag');
  };
  return {
    section,
    setSection,
    selectSection,
    selected,
    setSelected,
    selectionMode,
    setSelectionMode,
    selectRegion,
    constraintId,
    setConstraintId,
    loadId,
    setLoadId,
    namedSelectionId,
    setNamedSelectionId,
    fieldId,
    setFieldId,
    edges,
    setEdges,
    fieldSource,
    setFieldSource,
    chooseSource,
    field,
    availableFields,
    deformation,
    setDeformation,
    customScale,
    setCustomScale,
    animate,
    setAnimate,
    probe,
    setProbe,
    leftWidth,
    resize,
    adjustPanel,
    help,
    helpContext,
    setHelp,
    setHelpContext,
    showHelp,
    theme,
    preference,
    setPreference,
    reset,
  };
}
export type WorkbenchView = ReturnType<typeof useWorkbenchView>;
