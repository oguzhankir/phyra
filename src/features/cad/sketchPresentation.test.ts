import { describe, expect, it } from 'vitest';
import type { CadSketchDefinition } from '../../domain/contracts/project.generated';
import { sketchConstraintSelection, sketchPlaneAxes } from './sketchPresentation';

const graph: CadSketchDefinition = {
  points: [
    { id: 'a', position: [0, 0] },
    { id: 'b', position: [0.1, 0] },
    { id: 'c', position: [0.1, 0.1] },
  ],
  entities: [
    { id: 'ab', name: 'Lower edge', kind: 'line', startId: 'a', endId: 'b' },
    { id: 'bc', name: 'Right edge', kind: 'line', startId: 'b', endId: 'c' },
  ],
  constraints: [],
  loops: [],
};

describe('sketch presentation references', () => {
  it('matches every local plane axis to the exact embedding', () => {
    expect(sketchPlaneAxes('xy')).toEqual(['X', 'Y']);
    expect(sketchPlaneAxes('xz')).toEqual(['X', 'Z']);
    expect(sketchPlaneAxes('yz')).toEqual(['Y', 'Z']);
  });
  it('links dimensional and relational constraints without selecting unrelated connected curves', () => {
    const before = structuredClone(graph);
    expect(
      sketchConstraintSelection(graph, {
        id: 'distance',
        kind: 'distance',
        firstPointId: 'a',
        secondPointId: 'b',
        value: 0.1,
      }),
    ).toEqual([
      { kind: 'point', id: 'a' },
      { kind: 'point', id: 'b' },
    ]);
    expect(
      sketchConstraintSelection(graph, {
        id: 'equal',
        kind: 'equalLength',
        firstLineId: 'ab',
        secondLineId: 'bc',
      }),
    ).toEqual([
      { kind: 'entity', id: 'ab' },
      { kind: 'entity', id: 'bc' },
    ]);
    expect(graph).toEqual(before);
  });
  it('keeps a fixed point anchor exact and ignores a constraint ID that matches another geometry ID', () => {
    expect(
      sketchConstraintSelection(graph, { id: 'bc', kind: 'fixedPoint', pointId: 'a' }),
    ).toEqual([{ kind: 'point', id: 'a' }]);
  });
});
