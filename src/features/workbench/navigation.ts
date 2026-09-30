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
  loads: 'Assign distributed forces or normal pressure to boundaries.',
  results: 'Inspect authoritative physical fields and probe values.',
};
