import * as THREE from 'three';
import type { Project } from '../../domain/contracts/types';
import {
  numericArray,
  solutionArray,
  type ResultData,
  type FieldSource,
} from '../../domain/results/fields';
import { regionNames, type RegionId } from '../../domain/project/regions';

export type SurfaceData = {
  positions: Float64Array;
  triangles: Uint32Array;
  regions: Uint32Array;
  regionIds: RegionId[];
  cells?: Uint32Array;
  volumeCells?: Uint32Array;
  cellWidth?: number;
  displacement?: Float64Array;
  boundaryEdges?: Uint32Array;
  edgeRegions?: Uint32Array;
};
function primitiveSurface(project: Project): SurfaceData {
  const { kind, length: l, width: w, height: h, radius: r, thickness: t } = project.geometry;
  const regionIds = regionNames(kind, project.study.dimension).map((region) => region.id);
  if (project.study.dimension === '2d')
    return {
      positions: new Float64Array([0, 0, 0, l, 0, 0, l, w, 0, 0, w, 0]),
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      regions: new Uint32Array(2),
      regionIds,
      boundaryEdges: new Uint32Array([3, 0, 1, 2, 0, 1, 2, 3]),
      edgeRegions: new Uint32Array([0, 1, 2, 3]),
    };
  const vertices: number[] = [];
  const triangles: number[] = [];
  const regions: number[] = [];
  const triangle = (a: number[], b: number[], c: number[], region: RegionId) => {
    const start = vertices.length / 3;
    vertices.push(...a, ...b, ...c);
    triangles.push(start, start + 1, start + 2);
    regions.push(regionIds.indexOf(region));
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], region: RegionId) => {
    triangle(a, b, c, region);
    triangle(a, c, d, region);
  };
  if (kind === 'cylinder') {
    for (let i = 0; i < 72; i++) {
      const a = (2 * Math.PI * i) / 72;
      const b = (2 * Math.PI * (i + 1)) / 72;
      const a0 = [0, r * Math.cos(a), r * Math.sin(a)];
      const b0 = [0, r * Math.cos(b), r * Math.sin(b)];
      const a1 = [l, a0[1], a0[2]];
      const b1 = [l, b0[1], b0[2]];
      triangle([0, 0, 0], b0, a0, 'x0');
      triangle([l, 0, 0], a1, b1, 'x1');
      quad(a0, b0, b1, a1, 'outer');
    }
  } else {
    const outline =
      kind === 'bracket'
        ? [
            [0, 0],
            [l, 0],
            [l, t],
            [t, t],
            [t, w],
            [0, w],
          ]
        : [
            [0, 0],
            [l, 0],
            [l, w],
            [0, w],
          ];
    const sides: RegionId[] =
      kind === 'bracket'
        ? ['y0', 'x1', 'inner-y', 'inner-x', 'y1', 'x0']
        : ['y0', 'x1', 'y1', 'x0'];
    const top = outline.map(([x, y]) => [x, y, h]);
    const bottom = outline.map(([x, y]) => [x, y, 0]);
    const faces = THREE.ShapeUtils.triangulateShape(
      outline.map(([x, y]) => new THREE.Vector2(x, y)),
      [],
    );
    for (const [a, b, c] of faces) {
      triangle(bottom[c], bottom[b], bottom[a], 'z0');
      triangle(top[a], top[b], top[c], 'z1');
    }
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      quad(bottom[i], bottom[next], top[next], top[i], sides[i]);
    }
  }
  return {
    positions: new Float64Array(vertices),
    triangles: new Uint32Array(triangles),
    regions: new Uint32Array(regions),
    regionIds,
  };
}
export function surfaceData(
  project: Project,
  data: ResultData | null,
  source: FieldSource = 'primary',
): SurfaceData {
  if (!data) return primitiveSurface(project);
  return {
    positions: numericArray(data, 'positions') as Float64Array,
    triangles: numericArray(data, 'surface') as Uint32Array,
    regions: numericArray(data, 'surfaceRegions') as Uint32Array,
    regionIds: data.manifest.regions.map((region) => region.id as RegionId),
    cells: numericArray(data, 'surfaceCells') as Uint32Array,
    volumeCells: numericArray(data, 'cells') as Uint32Array,
    cellWidth: data.manifest.arrays.cells.shape[1],
    displacement:
      data.manifest.operation !== 'mesh' ? solutionArray(data, 'displacement', source) : undefined,
    boundaryEdges:
      data.manifest.dimension === '2d'
        ? (numericArray(data, 'boundaryEdges') as Uint32Array)
        : undefined,
    edgeRegions:
      data.manifest.dimension === '2d'
        ? (numericArray(data, 'edgeRegions') as Uint32Array)
        : undefined,
  };
}
