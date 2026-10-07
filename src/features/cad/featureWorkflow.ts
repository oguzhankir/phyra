import type { CadGeometry, CadSketchFeature } from '../../domain/contracts/project.generated';
import { featureDependencies } from '../../domain/project/document';
import { sketchReadiness } from './sketchInteractions';
import { advancedIssue, pathIssue, sourceSketch } from './advancedFeatures';

/** Readiness is scoped to the selected output; inactive authoring history stays editable. */
export function cadRebuildIssue(geometry: CadGeometry): string | null {
  const features = new Map(geometry.features.map((feature) => [feature.id, feature]));
  const visited = new Set<string>();
  const paths = new Set<string>();
  const collect = (id: string, seen = new Set<string>()) => {
    if (seen.has(id)) return;
    seen.add(id);
    const feature = features.get(id);
    if (!feature) return;
    if (feature.kind === 'sweep') {
      const sketch = sourceSketch(geometry.features, feature.spineId);
      if (sketch) paths.add(sketch.id);
    }
    featureDependencies(feature).forEach((input) => collect(input, seen));
  };
  collect(geometry.outputFeatureId);
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
      if (feature.purpose === 'path' && !paths.has(feature.id))
        return `${feature.name}: ${pathIssue(feature.sketch) ?? 'Path ready. Use Sweep to combine it with a closed profile before rebuilding.'}`;
      const issue = paths.has(feature.id)
        ? pathIssue(feature.sketch)
        : sketchReadiness(feature.sketch).issue;
      if (issue) return `${feature.name}: ${issue}`;
    }
    if (feature.kind === 'loft' || feature.kind === 'sweep' || feature.kind === 'assembly') {
      const issue = advancedIssue(
        feature,
        geometry.features.slice(0, geometry.features.indexOf(feature)),
      );
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
  const ready = (sketch: CadSketchFeature) =>
    sketch.purpose !== 'path' && !sketchReadiness(sketch.sketch).issue;
  if (selected && ready(selected)) return selected;
  return [...sketches].reverse().find(ready) ?? null;
}
