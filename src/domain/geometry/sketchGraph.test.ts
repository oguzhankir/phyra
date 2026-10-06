import { describe, expect, it } from 'vitest';
import { rectangularProfile } from '../project/profile';
import { graphProfile, profileGraph, sketchReferenceError } from './sketchGraph';

describe('authored CAD sketch projections', () => {
  it('preserves distinct coincident authored points instead of adding a hidden coincidence', () => {
    const graph = profileGraph(rectangularProfile(0.1, 0.05));
    const first = graph.entities[0];
    if (first.kind !== 'line') throw new Error('Fixture must be a line.');
    const original = graph.points.find((point) => point.id === first.endId)!;
    graph.points.push({ id: 'separate-coincident-point', position: [...original.position] });
    first.endId = 'separate-coincident-point';
    graph.constraints.push({ id: 'explicit-fixed', kind: 'fixedPoint', pointId: original.id });
    const converted = profileGraph(graphProfile(graph)!, graph);
    expect(converted.entities[0]).toEqual(first);
    expect(converted.points.find((point) => point.id === original.id)).toEqual(original);
    expect(
      converted.points.find((point) => point.id === 'separate-coincident-point')?.position,
    ).toEqual(original.position);
    expect(converted.constraints).toEqual(graph.constraints);
  });
  it('preserves authored nonloop construction entities and rejects removed constraint references', () => {
    const graph = profileGraph(rectangularProfile(0.1, 0.05));
    graph.points.push({ id: 'construction-center', position: [0.02, 0.03] });
    graph.entities.push({
      id: 'construction-circle',
      name: 'Construction circle',
      kind: 'circle',
      centerId: 'construction-center',
      radius: 0.01,
    });
    graph.constraints.push({
      id: 'construction-diameter',
      kind: 'diameter',
      curveId: 'construction-circle',
      value: 0.02,
    });
    const roundtrip = profileGraph(graphProfile(graph)!, graph);
    expect(roundtrip.entities.find((item) => item.id === 'construction-circle')).toEqual(
      graph.entities.at(-1),
    );
    expect(sketchReferenceError(roundtrip)).toBeNull();
    const boundaryId = graph.entities[0].id;
    graph.constraints.push({ id: 'boundary-direction', kind: 'horizontal', lineId: boundaryId });
    const newProfile = rectangularProfile(0.2, 0.1);
    newProfile.outer.forEach((edge, index) => {
      edge.id = `replacement-${index}`;
    });
    const replaced = profileGraph(newProfile, graph);
    expect(replaced.constraints).toEqual(graph.constraints);
    expect(sketchReferenceError(replaced)).toContain('boundary-direction');
    expect(graph.entities[0].id).toBe(boundaryId);
  });
});
