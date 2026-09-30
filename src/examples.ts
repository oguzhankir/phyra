import cantilever from '../examples/cantilever.json';
import cylinder from '../examples/cylinder.json';
import bracket from '../examples/bracket.json';
import extension from '../examples/extension.json';
import planeStressTension from '../examples/plane-stress-tension.json';
import type { Project } from './types';

export type ExampleId =
  'cantilever' | 'cylinder' | 'bracket' | 'extension' | 'plane-stress-tension';
// npm run generate checks these immutable definitions against the shared schema.
const examples: Record<ExampleId, unknown> = {
  cantilever,
  cylinder,
  bracket,
  extension,
  'plane-stress-tension': planeStressTension,
};

export function makeProject(example?: ExampleId): Project {
  const definition = examples[example ?? 'cantilever'];
  const project = structuredClone(definition) as Project;
  project.id = crypto.randomUUID();
  project.study.id = crypto.randomUUID();
  project.study.constraints.forEach((item) => {
    item.id = crypto.randomUUID();
  });
  project.study.loads.forEach((item) => {
    item.id = crypto.randomUUID();
  });
  if (!example) {
    project.name = 'Untitled project';
    project.study.constraints = [];
    project.study.loads = [];
  }
  return project;
}
