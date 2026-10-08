import type { CadFeature } from '../../domain/contracts/project.generated';

const labels: Record<CadFeature['kind'], string> = {
  'import-step': 'STEP import',
  sketch: 'Sketch',
  box: 'Box',
  cylinder: 'Cylinder',
  extrude: 'Extrusion',
  revolve: 'Revolution',
  boolean: 'Boolean',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  transform: 'Move / rotate',
  loft: 'Loft',
  sweep: 'Sweep',
  assembly: 'Assembly',
};

export function cadFeatureLabel(feature: CadFeature): string {
  return feature.kind === 'sketch' && feature.purpose === 'path'
    ? 'Sweep path'
    : labels[feature.kind];
}
