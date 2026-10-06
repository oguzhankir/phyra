import { describe, expect, it } from 'vitest';
import type { CadGeometry, CadSketchFeature } from '../../domain/contracts/project.generated';
import { profileGraph } from '../../domain/geometry/sketchGraph';
import { rectangularProfile } from '../../domain/project/profile';
import { cadRebuildIssue, usableSketch } from './featureWorkflow';
const open: CadSketchFeature = {
  id: 'open',
  name: 'Open sketch',
  kind: 'sketch',
  plane: 'xy',
  sketch: { points: [], entities: [], constraints: [], loops: [] },
};
const closed: CadSketchFeature = {
  id: 'closed',
  name: 'Closed sketch',
  kind: 'sketch',
  plane: 'xy',
  sketch: profileGraph(rectangularProfile(0.1, 0.05)),
};
describe('CAD authoring readiness', () => {
  it('permits an evaluated solid while retaining an inactive unfinished sketch', () => {
    const geometry: CadGeometry = {
      kind: 'cad',
      dimension: '3d',
      assets: [],
      outputFeatureId: 'box',
      features: [
        open,
        { id: 'box', name: 'Box', kind: 'box', length: 0.1, width: 0.05, height: 0.02 },
      ],
    };
    expect(cadRebuildIssue(geometry)).toBeNull();
    geometry.outputFeatureId = 'open';
    expect(cadRebuildIssue(geometry)).toContain('Open sketch');
  });
  it('traverses extrusion dependencies and picks a closed source instead of an unfinished last sketch', () => {
    const geometry: CadGeometry = {
      kind: 'cad',
      dimension: '3d',
      assets: [],
      outputFeatureId: 'extrude',
      features: [
        closed,
        open,
        { id: 'extrude', name: 'Extrusion', kind: 'extrude', sketchId: 'closed', distance: 0.02 },
      ],
    };
    expect(cadRebuildIssue(geometry)).toBeNull();
    expect(usableSketch([closed, open], 'open')?.id).toBe('closed');
    const extrusion = geometry.features[2];
    if (extrusion.kind === 'extrude') extrusion.sketchId = 'open';
    expect(cadRebuildIssue(geometry)).toContain('Open sketch');
  });
});
