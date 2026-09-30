export type Section =
  'study' | 'solver' | 'geometry' | 'material' | 'mesh' | 'constraints' | 'loads' | 'results';

export const sectionTitles: Record<Section, string> = {
  study: 'Study definition',
  solver: 'Solution method',
  geometry: 'Geometry',
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
  material: 'Define homogeneous isotropic elastic properties.',
  mesh: 'Control element size and inspect the discretization.',
  constraints: 'Assign prescribed displacement components to boundaries.',
  loads: 'Assign distributed forces or normal pressure to boundaries.',
  results: 'Inspect authoritative physical fields and probe values.',
};
