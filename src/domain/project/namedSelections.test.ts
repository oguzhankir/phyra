import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import {
  namedSelectionError,
  nextSelectionName,
  selectedBoundaries,
  selectionIsCompatible,
  selectionNameKey,
} from './namedSelections';

describe('reusable copied boundary sets', () => {
  it('preserves membership after size edits and rejects topology/dimension changes', () => {
    const project = makeProject('cantilever');
    const set = {
      id: 'fixture',
      name: 'Mount',
      geometryKind: 'box' as const,
      dimension: '3d' as const,
      regions: ['x0'] as ['x0'],
    };
    expect(selectionIsCompatible(project, set)).toBe(true);
    project.geometry.length *= 2;
    expect(selectionIsCompatible(project, set)).toBe(true);
    project.geometry.kind = 'cylinder';
    expect(selectionIsCompatible(project, set)).toBe(false);
    project.geometry.kind = 'box';
    project.study.dimension = '2d';
    expect(selectionIsCompatible(project, set)).toBe(false);
  });
  it('canonicalizes selection against actual current boundaries', () => {
    const project = makeProject('plane-stress-tension');
    expect(selectedBoundaries(project, ['y1', 'x0', 'z0', 'x0'])).toEqual(['x0', 'y1']);
  });
  it('uses the same explicit whitespace and ASCII fold policy as native/Python', () => {
    expect(selectionNameKey('\ufeff\u001cMOUNT\u0085')).toBe('mount');
    expect(selectionNameKey('ß')).not.toBe(selectionNameKey('SS'));
    expect(selectionNameKey('İ')).not.toBe(selectionNameKey('I'));
    const project = makeProject();
    project.namedSelections = [
      { id: 'a', name: '\ufeff', geometryKind: 'box', dimension: '2d', regions: ['x0'] },
    ];
    expect(namedSelectionError(project)).toContain('empty');
    project.namedSelections[0].name = 'Mount';
    project.namedSelections.push({ ...project.namedSelections[0], id: 'b', name: '\u001cMOUNT' });
    expect(namedSelectionError(project)).toContain('unique');
  });
  it('uses unique generated labels and copied regions do not link conditions', () => {
    const project = makeProject('cantilever');
    project.namedSelections = [
      { id: 'a', name: 'Boundary set 1', geometryKind: 'box', dimension: '3d', regions: ['x0'] },
    ];
    expect(nextSelectionName(project)).toBe('Boundary set 2');
    const original = [...project.study.constraints[0].regions];
    project.namedSelections[0].regions = ['x1'];
    expect(project.study.constraints[0].regions).toEqual(original);
  });
});
