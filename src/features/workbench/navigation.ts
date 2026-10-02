export type Section =
  | 'study'
  | 'solver'
  | 'geometry'
  | 'selections'
  | 'material'
  | 'mesh'
  | 'constraints'
  | 'loads'
  | 'results';

export type WorkflowStageId = 'prepare' | 'solve' | 'inspect';

export type WorkflowStage = {
  id: WorkflowStageId;
  number: number;
  title: string;
  description: string;
  entrySection: Section;
  sections: readonly Section[];
};

export const workflowStages: readonly WorkflowStage[] = [
  {
    id: 'prepare',
    number: 1,
    title: 'Prepare',
    description: 'Define geometry, material and conditions.',
    entrySection: 'study',
    sections: ['study', 'geometry', 'material', 'selections', 'constraints', 'loads'],
  },
  {
    id: 'solve',
    number: 2,
    title: 'Solve',
    description: 'Create a mesh and choose a method.',
    entrySection: 'mesh',
    sections: ['mesh', 'solver'],
  },
  {
    id: 'inspect',
    number: 3,
    title: 'Inspect',
    description: 'Review physical fields and run evidence.',
    entrySection: 'results',
    sections: ['results'],
  },
];

export function stageForSection(section: Section): WorkflowStage {
  return workflowStages.find((stage) => stage.sections.includes(section))!;
}

export const sectionTitles: Record<Section, string> = {
  study: 'Study definition',
  solver: 'Solution method',
  geometry: 'Geometry',
  selections: 'Named selections',
  material: 'Material',
  mesh: 'Mesh',
  constraints: 'Supports',
  loads: 'Loads',
  results: 'Results',
};

export const sectionDescriptions: Record<Section, string> = {
  study: 'Define the physical dimension and formulation.',
  solver: 'Configure the numerical method and execution device.',
  geometry: 'Set the domain dimensions and inspect its boundaries.',
  selections: 'Save reusable boundary groups for this geometry and copy them into assignments.',
  material: 'Define homogeneous isotropic elastic properties.',
  mesh: 'Control element size and inspect the discretization.',
  constraints: 'Assign prescribed displacement components to boundaries.',
  loads: 'Assign total forces, normal pressure or spatial traction to boundaries.',
  results: 'Inspect authoritative physical fields and probe values.',
};
