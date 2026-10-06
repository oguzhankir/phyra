import type { CadGeometry, CadSketchFeature } from '../../domain/contracts/project.generated';
import { featureDependencies } from '../../domain/project/document';
import { sketchReadiness } from './sketchInteractions';

/** Readiness is scoped to the selected output; inactive authoring history stays editable. */
export function cadRebuildIssue(geometry: CadGeometry): string | null {
  const features = new Map(geometry.features.map((feature) => [feature.id, feature]));
  const visited = new Set<string>();
  const visit = (id: string): string | null => {
    if (visited.has(id)) return null;
    const feature = features.get(id);
    if (!feature) return 'The output references a missing feature.';
    visited.add(id);
    for (const input of featureDependencies(feature)) {
      const issue = visit(input);
      if (issue) return issue;
    }
    if (feature.kind === 'sketch') {
      const issue = sketchReadiness(feature.sketch).issue;
      if (issue) return `${feature.name}: ${issue}`;
    }
    return null;
  };
  return visit(geometry.outputFeatureId);
}
export function usableSketch(
  sketches: CadSketchFeature[],
  selectedId?: string,
): CadSketchFeature | null {
  const selected = sketches.find((sketch) => sketch.id === selectedId);
  if (selected && !sketchReadiness(selected.sketch).issue) return selected;
  return [...sketches].reverse().find((sketch) => !sketchReadiness(sketch.sketch).issue) ?? null;
}
