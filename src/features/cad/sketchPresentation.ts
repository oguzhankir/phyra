import type {
  CadSketchConstraint,
  CadSketchDefinition,
  CadSketchFeature,
} from '../../domain/contracts/project.generated';
import type { SketchSelection } from './sketchInteractions';

const constraintLabels: Record<CadSketchConstraint['kind'], string> = {
  fixedPoint: 'Fixed point',
  coincident: 'Coincident',
  distance: 'Distance',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  diameter: 'Diameter',
  equalLength: 'Equal length',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  equalRadius: 'Equal radius',
};

export const sketchConstraintLabel = (kind: CadSketchConstraint['kind']) => constraintLabels[kind];

/** These labels follow the exact kernel's (u,v) plane embedding; coordinates stay in SI. */
export function sketchPlaneAxes(plane: CadSketchFeature['plane']): readonly [string, string] {
  return plane === 'xy' ? ['X', 'Y'] : plane === 'xz' ? ['X', 'Z'] : ['Y', 'Z'];
}

/** Select only authored geometry referenced by this constraint, preserving graph identities. */
export function sketchConstraintSelection(
  graph: CadSketchDefinition,
  constraint: CadSketchConstraint,
): SketchSelection[] {
  const references = new Set(
    Object.entries(constraint)
      .filter(([key]) => key.endsWith('Id'))
      .map(([, id]) => String(id)),
  );
  return [
    ...graph.entities
      .filter((entity) => references.has(entity.id))
      .map((entity) => ({ kind: 'entity' as const, id: entity.id })),
    ...graph.points
      .filter((point) => references.has(point.id))
      .map((point) => ({ kind: 'point' as const, id: point.id })),
  ];
}
