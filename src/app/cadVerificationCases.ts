import type { CadGeometry } from '../domain/contracts/project.generated';
import { profileGraph } from '../domain/geometry/sketchGraph';
import { rectangularProfile } from '../domain/project/profile';

/** Authored recipes with independent elementary area/volume references, driven through the desktop owner. */
export function cadVerificationCases(): {
  name: string;
  geometry: CadGeometry;
  volume: number;
  bodies: number;
}[] {
  const loft: CadGeometry = {
    kind: 'cad',
    dimension: '3d',
    assets: [],
    outputFeatureId: 'loft',
    features: [
      {
        id: 'profile',
        name: 'Rectangular section',
        kind: 'sketch',
        plane: 'xy',
        sketch: profileGraph({ ...rectangularProfile(0.04, 0.02), holes: [] }),
      },
      {
        id: 'placed',
        name: 'End section',
        kind: 'transform',
        inputId: 'profile',
        translation: [0, 0, 0.03],
        axisOrigin: [0, 0, 0],
        axisDirection: [0, 0, 1],
        angle: 0,
      },
      {
        id: 'loft',
        name: 'Loft',
        kind: 'loft',
        sectionIds: ['profile', 'placed'],
        solid: true,
        ruled: false,
      },
    ],
  };
  const surface = structuredClone(loft);
  if (surface.features[2].kind === 'loft') surface.features[2].solid = false;
  const sweep: CadGeometry = {
    kind: 'cad',
    dimension: '3d',
    assets: [],
    outputFeatureId: 'sweep',
    features: [
      {
        id: 'profile',
        name: 'YZ cross-section',
        kind: 'sketch',
        plane: 'yz',
        sketch: profileGraph({ ...rectangularProfile(0.01, 0.01), holes: [] }),
      },
      {
        id: 'path',
        name: 'X path',
        kind: 'sketch',
        purpose: 'path',
        plane: 'xy',
        sketch: {
          points: [
            { id: 'a', position: [0, 0] },
            { id: 'b', position: [0.05, 0] },
          ],
          entities: [{ id: 'line', name: 'Path segment', kind: 'line', startId: 'a', endId: 'b' }],
          constraints: [],
          loops: [],
        },
      },
      {
        id: 'sweep',
        name: 'Sweep',
        kind: 'sweep',
        profileId: 'profile',
        spineId: 'path',
        solid: true,
      },
    ],
  };
  const assembly: CadGeometry = {
    kind: 'cad',
    dimension: '3d',
    assets: [],
    outputFeatureId: 'assembly',
    features: [
      { id: 'part', name: 'Part', kind: 'box', length: 0.03, width: 0.02, height: 0.01 },
      {
        id: 'placed',
        name: 'Second part placement',
        kind: 'transform',
        inputId: 'part',
        translation: [0.05, 0, 0],
        axisOrigin: [0, 0, 0],
        axisDirection: [0, 0, 1],
        angle: 0,
      },
      {
        id: 'assembly',
        name: 'Assembly',
        kind: 'assembly',
        components: [
          { id: 'left', name: 'Left part', featureId: 'part' },
          { id: 'right', name: 'Right part', featureId: 'placed' },
        ],
      },
    ],
  };
  return [
    { name: 'loft-solid', geometry: loft, volume: 0.04 * 0.02 * 0.03, bodies: 1 },
    { name: 'loft-surface', geometry: surface, volume: 0, bodies: 0 },
    { name: 'sweep', geometry: sweep, volume: 0.01 * 0.01 * 0.05, bodies: 1 },
    { name: 'assembly', geometry: assembly, volume: 2 * 0.03 * 0.02 * 0.01, bodies: 2 },
  ];
}
