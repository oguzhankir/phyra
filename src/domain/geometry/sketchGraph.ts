import type { CadSketchDefinition, Profile, Point2 } from '../contracts/project.generated';

/** An editing projection; the authored graph remains the only saved definition. */
export function graphProfile(sketch: CadSketchDefinition): Profile | null {
  const outer = sketch.loops.filter((loop) => loop.role === 'outer');
  if (outer.length !== 1) return null;
  const points = new Map(sketch.points.map((point) => [point.id, point.position]));
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  const edges: Profile['outer'][number][] = [];
  for (const id of outer[0].entityIds) {
    const entity = entities.get(id);
    if (!entity || entity.kind === 'circle') return null;
    const start = points.get(entity.startId),
      end = points.get(entity.endId);
    if (!start || !end) return null;
    if (entity.kind === 'line')
      edges.push({ id, name: entity.name, kind: 'line', start: [...start], end: [...end] });
    else {
      const center = points.get(entity.centerId);
      if (!center) return null;
      edges.push({
        id,
        name: entity.name,
        kind: 'arc',
        start: [...start],
        end: [...end],
        center: [...center],
        clockwise: entity.clockwise,
      });
    }
  }
  if (edges.length < 2 || edges.length > 64) return null;
  const holes: Profile['holes'] = [];
  for (const loop of sketch.loops.filter((item) => item.role === 'hole')) {
    if (loop.entityIds.length !== 1) return null;
    const entity = entities.get(loop.entityIds[0]);
    if (!entity || entity.kind !== 'circle') return null;
    const center = points.get(entity.centerId);
    if (!center) return null;
    holes.push({ id: entity.id, name: entity.name, center: [...center], radius: entity.radius });
  }
  if (holes.length > 16) return null;
  return { outer: edges as Profile['outer'], holes };
}

/** Preserve point identity when editing surviving entities; dropped refs require explicit repair. */
export function profileGraph(
  profile: Profile,
  previous?: CadSketchDefinition,
): CadSketchDefinition {
  const oldEntities = new Map(previous?.entities.map((entity) => [entity.id, entity]) ?? []);
  const oldPointIds = new Set(previous?.points.map((point) => point.id) ?? []);
  const points: CadSketchDefinition['points'] = [];
  const byCoordinate = new Map<string, string>();
  const used = new Set<string>();
  const put = (point: Point2, preferred?: string): string => {
    const key = JSON.stringify(point);
    if (preferred && used.has(preferred)) {
      const existing = points.find((item) => item.id === preferred)!;
      if (JSON.stringify(existing.position) !== key)
        throw new Error(
          'The sketch edit separates an authored shared point. Repair its connectivity explicitly.',
        );
      return preferred;
    }
    const shared = !preferred ? byCoordinate.get(key) : undefined;
    if (shared) return shared;
    let id = preferred ?? `point_${points.length + 1}`;
    while (used.has(id) || (!preferred && oldPointIds.has(id))) id += '_new';
    used.add(id);
    byCoordinate.set(key, id);
    points.push({ id, position: [...point] });
    return id;
  };
  const entities: CadSketchDefinition['entities'] = profile.outer.map((edge) => {
    const old = oldEntities.get(edge.id);
    const startId = put(edge.start, old && old.kind !== 'circle' ? old.startId : undefined);
    const endId = put(edge.end, old && old.kind !== 'circle' ? old.endId : undefined);
    return edge.kind === 'line'
      ? { id: edge.id, name: edge.name, kind: 'line', startId, endId }
      : {
          id: edge.id,
          name: edge.name,
          kind: 'arc',
          startId,
          endId,
          centerId: put(edge.center!, old?.kind === 'arc' ? old.centerId : undefined),
          clockwise: edge.clockwise!,
        };
  });
  for (const hole of profile.holes) {
    const old = oldEntities.get(hole.id);
    entities.push({
      id: hole.id,
      name: hole.name,
      kind: 'circle',
      centerId: put(hole.center, old?.kind === 'circle' ? old.centerId : undefined),
      radius: hole.radius,
    });
  }
  const oldLoopEntities = new Set(previous?.loops.flatMap((loop) => loop.entityIds) ?? []);
  for (const entity of previous?.entities ?? [])
    if (!oldLoopEntities.has(entity.id)) entities.push(structuredClone(entity));
  for (const point of previous?.points ?? [])
    if (!used.has(point.id)) points.push(structuredClone(point));
  const constraints = structuredClone(previous?.constraints ?? []);
  return {
    points,
    entities,
    constraints,
    loops: [
      {
        id: 'outer',
        role: 'outer',
        entityIds: profile.outer.map((edge) => edge.id) as [string, ...string[]],
      },
      ...profile.holes.map((hole) => ({
        id: `loop_${hole.id}`,
        role: 'hole' as const,
        entityIds: [hole.id] as [string, ...string[]],
      })),
    ],
  };
}

/** Sketch edits never silently discard authored constraints. Repair references explicitly. */
export function sketchReferenceError(sketch: CadSketchDefinition): string | null {
  const points = new Set(sketch.points.map((point) => point.id)),
    entities = new Set(sketch.entities.map((entity) => entity.id));
  for (const constraint of sketch.constraints)
    for (const [key, value] of Object.entries(constraint)) {
      if (key === 'id' || !key.endsWith('Id')) continue;
      const isPoint = key === 'pointId' || key.endsWith('PointId');
      if (!(isPoint ? points : entities).has(String(value)))
        return `Constraint ${constraint.id} references a removed ${isPoint ? 'point' : 'entity'}. Delete or repair that constraint before applying this sketch.`;
    }
  return null;
}
