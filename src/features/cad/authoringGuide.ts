import type { CadGeometry, CadSketchFeature } from '../../domain/contracts/project.generated';
import { entityPoints } from './sketchInteractions';
type Point3 = [number, number, number];

export interface CadAuthoringGuide {
  positions: Float64Array;
  label: string;
  truncated: boolean;
}
const MAX_SEGMENTS = 50000;
/** Presentation-only outlines. Never supplies topology, shape validity, exports or analysis inputs. */
export function cadAuthoringGuide(geometry: CadGeometry): CadAuthoringGuide | null {
  const features = new Map(geometry.features.map((feature) => [feature.id, feature]));
  const point = (sketch: CadSketchFeature, p: [number, number]): Point3 =>
    sketch.plane === 'xy'
      ? [p[0], p[1], 0]
      : sketch.plane === 'xz'
        ? [p[0], 0, p[1]]
        : [0, p[0], p[1]];
  let truncated = false,
    visits = 0,
    remainingSegments = MAX_SEGMENTS;
  const bounded = (segments: Point3[][]): Point3[][] => {
    const accepted = Math.min(segments.length, remainingSegments);
    if (accepted < segments.length) truncated = true;
    remainingSegments -= accepted;
    return segments.slice(0, accepted);
  };
  const sketchSegments = (sketch: CadSketchFeature): Point3[][] =>
    sketch.sketch.entities.flatMap((entity) => {
      const vertices = entityPoints(sketch.sketch, entity).map((p) => point(sketch, p));
      return vertices.slice(1).map((p, i) => [vertices[i], p]);
    });
  const visit = (id: string, depth = 0): Point3[][] => {
    if (depth > 128 || ++visits > 256 || remainingSegments <= 0) {
      truncated = true;
      return [];
    }
    const feature = features.get(id);
    if (!feature) return [];
    if (feature.kind === 'sketch') return bounded(sketchSegments(feature));
    if (feature.kind === 'loft')
      return bounded(feature.sectionIds.flatMap((section) => visit(section, depth + 1)));
    if (feature.kind === 'sweep')
      return bounded([
        ...visit(feature.profileId, depth + 1),
        ...visit(feature.spineId, depth + 1),
      ]);
    if (feature.kind === 'assembly')
      return bounded(
        feature.components.flatMap((component) => visit(component.featureId, depth + 1)),
      );
    if (feature.kind === 'box') {
      const p: Point3[] = [
        [0, 0, 0],
        [feature.length, 0, 0],
        [feature.length, feature.width, 0],
        [0, feature.width, 0],
        [0, 0, feature.height],
        [feature.length, 0, feature.height],
        [feature.length, feature.width, feature.height],
        [0, feature.width, feature.height],
      ];
      return [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ].map(([a, b]) => [p[a], p[b]]);
    }
    if (feature.kind === 'cylinder') {
      const rings = [0, feature.length].map((x) =>
        Array.from({ length: 65 }, (_, i): Point3 => [
          x,
          feature.radius * Math.cos((i * Math.PI) / 32),
          feature.radius * Math.sin((i * Math.PI) / 32),
        ]),
      );
      return [
        ...rings.flatMap((ring) => ring.slice(1).map((p, i) => [ring[i], p])),
        ...[0, 16, 32, 48].map((i) => [rings[0][i], rings[1][i]]),
      ];
    }
    if (feature.kind === 'extrude') {
      const sketch = features.get(feature.sketchId);
      if (sketch?.kind !== 'sketch') return [];
      const normal: Point3 =
        sketch.plane === 'xy' ? [0, 0, 1] : sketch.plane === 'xz' ? [0, -1, 0] : [1, 0, 0];
      const moved = (p: Point3): Point3 =>
        p.map((value, i) => value + normal[i] * feature.distance) as Point3;
      const base = sketchSegments(sketch);
      const joins = sketch.sketch.points
        .filter((p) =>
          sketch.sketch.entities.some(
            (e) => e.kind !== 'circle' && (e.startId === p.id || e.endId === p.id),
          ),
        )
        .map((p) => {
          const start = point(sketch, p.position);
          return [start, moved(start)];
        });
      return bounded([...base, ...base.map((segment) => segment.map(moved)), ...joins]);
    }
    if (feature.kind === 'transform') {
      const magnitude = Math.hypot(...feature.axisDirection);
      if (!magnitude) return [];
      const axis = feature.axisDirection.map((n) => n / magnitude),
        c = Math.cos(feature.angle),
        s = Math.sin(feature.angle);
      return bounded(
        visit(feature.inputId, depth + 1).map((segment) =>
          segment.map((p): Point3 => {
            const q = p.map((n, i) => n - feature.axisOrigin[i]),
              dot = q.reduce((sum, n, i) => sum + n * axis[i], 0);
            const cross = [
              axis[1] * q[2] - axis[2] * q[1],
              axis[2] * q[0] - axis[0] * q[2],
              axis[0] * q[1] - axis[1] * q[0],
            ];
            return q.map(
              (n, i) =>
                n * c +
                cross[i] * s +
                axis[i] * dot * (1 - c) +
                feature.axisOrigin[i] +
                feature.translation[i],
            ) as Point3;
          }),
        ),
      );
    }
    if (feature.kind === 'boolean')
      return bounded([...visit(feature.leftId, depth + 1), ...visit(feature.rightId, depth + 1)]);
    if (feature.kind === 'fillet' || feature.kind === 'chamfer')
      return visit(feature.inputId, depth + 1);
    if (feature.kind === 'revolve') return visit(feature.sketchId, depth + 1);
    return [];
  };
  const segments = visit(geometry.outputFeatureId);
  if (!segments.length) return null;
  const feature = features.get(geometry.outputFeatureId)!;
  const label =
    feature.kind === 'sketch'
      ? 'Saved sketch outline'
      : ['boolean', 'fillet', 'chamfer', 'revolve', 'loft', 'sweep'].includes(feature.kind)
        ? 'Input outlines · operation awaits exact rebuild'
        : 'Authoring outline · exact rebuild required';
  return { positions: new Float64Array(segments.flat(2)), label, truncated };
}
