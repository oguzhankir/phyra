import type { CadFeature, CadSketchFeature } from '../../domain/contracts/project.generated';
import { sketchReadiness } from './sketchInteractions';
import { featureDependencies } from '../../domain/project/document';

export type AdvancedFeature = Extract<CadFeature, { kind: 'loft' | 'sweep' | 'assembly' }>;
export type AdvancedKind = AdvancedFeature['kind'];
export const cadId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

/** Reused source placements split before editing so one instance can move independently. */
export function componentPlacement(
  features: readonly CadFeature[],
  assembly: Extract<CadFeature, { kind: 'assembly' }>,
  componentId: string,
) {
  const component = assembly.components.find((item) => item.id === componentId);
  const source = features.find((item) => item.id === component?.featureId);
  if (!component || !source) return null;
  const references = features.flatMap(featureDependencies).filter((id) => id === source.id).length;
  if (source.kind === 'transform' && references === 1) return { placement: source, insert: false };
  const placement: Extract<CadFeature, { kind: 'transform' }> =
    source.kind === 'transform'
      ? { ...structuredClone(source), id: cadId('transform'), name: `${component.name} placement` }
      : {
          id: cadId('transform'),
          name: `${component.name} placement`,
          kind: 'transform',
          inputId: source.id,
          translation: [0, 0, 0],
          axisOrigin: [0, 0, 0],
          axisDirection: [0, 0, 1],
          angle: 0,
        };
  return { placement, insert: true };
}

/** Presentation admission only. The owned exact kernel independently validates every operation. */
export function sourceSketch(features: readonly CadFeature[], id: string): CadSketchFeature | null {
  const indexed = new Map(features.map((feature) => [feature.id, feature]));
  const visited = new Set<string>();
  while (!visited.has(id)) {
    visited.add(id);
    const feature = indexed.get(id);
    if (feature?.kind === 'sketch') return feature;
    if (feature?.kind !== 'transform') return null;
    id = feature.inputId;
  }
  return null;
}
export function pathIssue(sketch: CadSketchFeature['sketch']): string | null {
  if (
    sketch.loops.length ||
    !sketch.entities.length ||
    sketch.entities.some((entity) => entity.kind === 'circle')
  )
    return 'A sweep path needs one open chain of lines and arcs, with no closed loops.';
  const adjacent = new Map<string, string[]>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'circle') continue;
    if (entity.startId === entity.endId) return 'A path segment needs distinct endpoints.';
    adjacent.set(entity.startId, [...(adjacent.get(entity.startId) ?? []), entity.endId]);
    adjacent.set(entity.endId, [...(adjacent.get(entity.endId) ?? []), entity.startId]);
  }
  if (
    [...adjacent.values()].some((items) => items.length > 2) ||
    [...adjacent.values()].filter((items) => items.length === 1).length !== 2
  )
    return 'The path must have two endpoints and no branches. Join segments using shared sketch points.';
  const visited = new Set<string>(),
    pending = [adjacent.keys().next().value!];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(adjacent.get(id) ?? []));
  }
  return visited.size === adjacent.size ? null : 'The sweep path contains disconnected segments.';
}
export function profileInputs(features: readonly CadFeature[]): CadFeature[] {
  return features.filter((feature) => {
    const sketch = sourceSketch(features, feature.id);
    return (
      sketch &&
      sketch.purpose !== 'path' &&
      !sketchReadiness(sketch.sketch).issue &&
      !sketch.sketch.loops.some((loop) => loop.role === 'hole')
    );
  });
}
export function pathInputs(features: readonly CadFeature[]): CadFeature[] {
  return features.filter((feature) => {
    const sketch = sourceSketch(features, feature.id);
    return sketch && !pathIssue(sketch.sketch);
  });
}
export function bodyInputs(features: readonly CadFeature[]): CadFeature[] {
  const indexed = new Map(features.map((feature) => [feature.id, feature]));
  const isBody = (feature: CadFeature, visited = new Set<string>()): boolean => {
    if (visited.has(feature.id)) return false;
    visited.add(feature.id);
    if (feature.kind === 'sketch') return false;
    if (feature.kind === 'loft' || feature.kind === 'sweep') return feature.solid;
    if (feature.kind === 'transform') {
      const input = indexed.get(feature.inputId);
      return !!input && isBody(input, visited);
    }
    return true;
  };
  return features.filter((feature) => isBody(feature));
}
export function advancedIssue(
  feature: AdvancedFeature,
  features: readonly CadFeature[],
): string | null {
  const profiles = new Set(profileInputs(features).map((item) => item.id));
  if (feature.kind === 'loft') {
    if (
      feature.sectionIds.length < 2 ||
      feature.sectionIds.length > 16 ||
      new Set(feature.sectionIds).size !== feature.sectionIds.length
    )
      return 'Choose 2–16 distinct sections in their loft order.';
    if (feature.sectionIds.some((id) => !profiles.has(id)))
      return 'Each loft section must be a closed sketch without holes, or its rigid placement.';
  } else if (feature.kind === 'sweep') {
    if (!profiles.has(feature.profileId)) return 'Choose a closed profile without holes.';
    if (!pathInputs(features).some((item) => item.id === feature.spineId))
      return 'Choose one connected open sketch path.';
  } else {
    if (!feature.components.length || feature.components.length > 32)
      return 'Add 1–32 component instances.';
    const bodies = new Set(bodyInputs(features).map((item) => item.id));
    if (
      feature.components.some(
        (component) => !component.name.trim() || !bodies.has(component.featureId),
      )
    )
      return 'Each component needs a name and an earlier solid source.';
  }
  return null;
}
export function newAdvancedFeature(
  kind: AdvancedKind,
  features: readonly CadFeature[],
  selectedId?: string,
): AdvancedFeature {
  const id = cadId(kind),
    profiles = profileInputs(features),
    paths = pathInputs(features),
    bodies = bodyInputs(features);
  if (kind === 'loft')
    return {
      id,
      name: 'Loft',
      kind,
      sectionIds: profiles.slice(-2).map((item) => item.id) as [string, string, ...string[]],
      solid: true,
      ruled: false,
    };
  if (kind === 'sweep')
    return {
      id,
      name: 'Sweep',
      kind,
      profileId: profiles.find((item) => item.id === selectedId)?.id ?? '',
      spineId: paths.find((item) => item.id === selectedId)?.id ?? paths.at(-1)?.id ?? '',
      solid: true,
    };
  const source = bodies.find((item) => item.id === selectedId) ?? bodies.at(-1);
  return {
    id,
    name: 'Assembly',
    kind,
    components: [{ id: cadId('component'), name: source!.name, featureId: source!.id }],
  };
}
