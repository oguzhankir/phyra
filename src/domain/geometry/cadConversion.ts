import type { CadGeometry, NumericalProject } from '../contracts/types';
import { rectangularProfile } from '../project/profile';
import { profileGraph } from './sketchGraph';

/** Explicit exact conversions only; unsupported legacy primitives retain their editor. */
export function numericalCadGeometry(project: NumericalProject): CadGeometry | null {
  const g = project.geometry,
    dimension = project.study.dimension;
  if (dimension === '2d' && (g.kind === 'box' || g.kind === 'profile')) {
    const profile = g.kind === 'profile' ? g.profile : rectangularProfile(g.length, g.width);
    if (!profile) return null;
    if (g.kind === 'box') profile.holes = [];
    return {
      kind: 'cad',
      dimension,
      features: [
        {
          id: 'source-sketch',
          name: 'Source plane profile',
          kind: 'sketch',
          plane: 'xy',
          sketch: profileGraph(profile),
        },
      ],
      outputFeatureId: 'source-sketch',
      assets: [],
    };
  }
  if (dimension === '3d' && g.kind === 'box')
    return {
      kind: 'cad',
      dimension,
      features: [
        {
          id: 'source-box',
          name: 'Source solid',
          kind: 'box',
          length: g.length,
          width: g.width,
          height: g.height,
        },
      ],
      outputFeatureId: 'source-box',
      assets: [],
    };
  if (dimension === '3d' && g.kind === 'cylinder')
    return {
      kind: 'cad',
      dimension,
      features: [
        {
          id: 'source-cylinder',
          name: 'Source cylinder',
          kind: 'cylinder',
          length: g.length,
          radius: g.radius,
        },
      ],
      outputFeatureId: 'source-cylinder',
      assets: [],
    };
  return null;
}
