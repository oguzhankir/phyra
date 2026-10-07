import type { CadPreview } from '../../domain/geometry/cadPreview';

export function cadLegacyBodyId(preview: CadPreview) {
  return preview.bodies.length === 1 && !preview.faces.some((face) => face.bodyId !== undefined)
    ? preview.bodies[0].id
    : undefined;
}

/** Presentation indices only: authoritative positions and exact topology references stay unchanged. */
export function cadVisiblePrimitives(preview: CadPreview, hiddenBodies: readonly string[]) {
  const hidden = new Set(hiddenBodies);
  const legacyBodyId = cadLegacyBodyId(preview);
  return {
    triangles: Array.from(preview.triangleFaces, (_, index) => index).filter(
      (index) =>
        !hidden.has(preview.faces[preview.triangleFaces[index]].bodyId ?? legacyBodyId ?? ''),
    ),
    segments: Array.from(preview.segmentEdges, (_, index) => index).filter(
      (index) =>
        !hidden.has(preview.edges[preview.segmentEdges[index]].bodyId ?? legacyBodyId ?? ''),
    ),
  };
}
export function cadBodyAtTriangle(preview: CadPreview, source: number) {
  const face = preview.faces[preview.triangleFaces[source]];
  return face
    ? (preview.bodies.find((body) => body.id === face.bodyId) ??
        (cadLegacyBodyId(preview) ? preview.bodies[0] : null))
    : null;
}
