import { isNumericalProject } from '../domain/project/document';
import { primaryOperation, supportsPinn } from '../domain/project/study';
import type { CommandAction } from '../features/workbench/CommandPalette';
import {
  sectionDescriptions,
  sectionTitles,
  workflowStages,
} from '../features/workbench/navigation';
import type { Workbench } from './useWorkbench';

type CommandModel = Pick<
  Workbench,
  | 'project'
  | 'isPinn'
  | 'locked'
  | 'nativeLocked'
  | 'preparation'
  | 'desktop'
  | 'validation'
  | 'solved'
  | 'selectSection'
  | 'create'
  | 'open'
  | 'save'
  | 'execute'
  | 'exportFields'
  | 'showHelp'
>;

// The command catalogue uses the same guarded actions as menus and editors.
export function createWorkbenchCommands(model: CommandModel): CommandAction[] {
  const {
    project,
    isPinn,
    locked,
    nativeLocked,
    preparation,
    desktop,
    validation,
    solved,
    selectSection,
    create,
    open,
    save,
    execute,
    exportFields,
    showHelp,
  } = model;
  const canCompute = !locked && !nativeLocked && preparation.canRun && desktop;
  const canMesh = !locked && !nativeLocked && preparation.canMesh && desktop;
  return [
    ...workflowStages.flatMap((item) =>
      item.sections.map((target) => ({
        id: target,
        label: sectionTitles[target],
        description: sectionDescriptions[target],
        group: item.title,
        keywords: target === 'constraints' ? 'boundary conditions restraints symmetry' : target,
        action: () => selectSection(target),
      })),
    ),
    {
      id: 'new',
      label: 'New project',
      description: 'Start an editable study.',
      group: 'Project',
      disabled: locked,
      action: () => void create(),
    },
    {
      id: 'open',
      label: 'Open project',
      description: desktop ? 'Reopen a local .phyra archive.' : 'Requires the desktop app.',
      group: 'Project',
      disabled: locked || nativeLocked || !desktop,
      action: () => void open(),
    },
    {
      id: 'save',
      label: 'Save project',
      description: desktop
        ? 'Save the definition and current fields.'
        : 'Requires the desktop app.',
      group: 'Project',
      disabled: locked || nativeLocked || !!validation || !desktop,
      action: () => void save(),
    },
    {
      id: 'generate-mesh',
      label: 'Generate mesh',
      description: 'Build a mesh from the current geometry.',
      group: 'Solve',
      disabled: !canMesh,
      action: () => void execute('mesh'),
    },
    {
      id: 'run',
      label: isPinn ? 'Train PINN' : 'Run FEM',
      description: 'Compute fields for the current physical inputs.',
      group: 'Solve',
      disabled: !canCompute,
      action: () => void execute(isNumericalProject(project) ? primaryOperation(project) : 'solve'),
    },
    ...(isNumericalProject(project) && supportsPinn(project)
      ? [
          {
            id: 'compare',
            label: 'Compare FEM + PINN',
            description: 'Evaluate both methods at matching physical locations.',
            group: 'Solve',
            disabled: !canCompute,
            action: () => void execute('compare'),
          },
        ]
      : []),
    {
      id: 'export',
      label: 'Export physical fields',
      description: 'Export current nodal and element fields in SI units.',
      group: 'Inspect',
      disabled: locked || nativeLocked || !solved || !desktop,
      action: () => void exportFields(),
    },
    {
      id: 'help',
      label: 'Open help',
      description: 'Search offline task and method guides.',
      group: 'Help',
      keywords: 'documentation glossary capabilities',
      action: () => showHelp(),
    },
  ];
}
