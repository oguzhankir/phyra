import cantilever from '../../../examples/cantilever.json';
import cylinder from '../../../examples/cylinder.json';
import bracket from '../../../examples/bracket.json';
import extension from '../../../examples/extension.json';
import planeStressTension from '../../../examples/plane-stress-tension.json';
import kirschQuarter from '../../../examples/kirsch-quarter.json';
import energyTension from '../../../examples/energy-tension.json';
import eccentricDisplacement from '../../../examples/eccentric-displacement.json';
import energyHole from '../../../examples/energy-hole.json';
import type { NumericalProject } from '../../domain/contracts/types';

export type ExampleId =
  | 'cantilever'
  | 'cylinder'
  | 'bracket'
  | 'extension'
  | 'plane-stress-tension'
  | 'kirsch-quarter'
  | 'energy-tension'
  | 'eccentric-displacement'
  | 'energy-hole';
// npm run generate checks these immutable definitions against the shared schema.
const examples: Record<ExampleId, unknown> = {
  cantilever,
  cylinder,
  bracket,
  extension,
  'plane-stress-tension': planeStressTension,
  'kirsch-quarter': kirschQuarter,
  'energy-tension': energyTension,
  'eccentric-displacement': eccentricDisplacement,
  'energy-hole': energyHole,
};

export function makeProject(example?: ExampleId): NumericalProject {
  const definition = examples[example ?? 'cantilever'];
  const project = structuredClone(definition) as NumericalProject;
  project.id = crypto.randomUUID();
  project.study.id = crypto.randomUUID();
  project.study.constraints.forEach((item) => {
    item.id = crypto.randomUUID();
  });
  project.study.loads.forEach((item) => {
    item.id = crypto.randomUUID();
  });
  project.namedSelections.forEach((item) => {
    item.id = crypto.randomUUID();
  });
  if (!example) {
    project.name = 'Untitled project';
    project.study.constraints = [];
    project.study.loads = [];
    project.namedSelections = [];
  }
  return project;
}
