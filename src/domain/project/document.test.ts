import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '../../../contracts/project.schema.json';
import frozenV5 from '../../../contracts/project-v5.schema.json';
import type { ProjectDefinition } from '../contracts/types';
import {
  blankProject,
  cadDefinitionError,
  documentError,
  documentPreparation,
  documentSizeError,
  isNumericalProject,
} from './document';
import { createHistory, recordEdit, undo, redo } from './history';
import { makeProject } from '../../features/examples/projects';

const validate = new Ajv({ strict: true }).compile(schema),
  validateOld = new Ajv({ strict: true }).compile(frozenV5);
describe('independent geometry and lazy studies', () => {
  it('rejects a structurally bounded CAD definition that exceeds the shared UTF-8 document budget', () => {
    const project = blankProject();
    const points = Array.from({ length: 128 }, (_, index) => ({
      id: `point-${index}`,
      position: [
        0.01 * Math.cos((index * 2 * Math.PI) / 128),
        0.01 * Math.sin((index * 2 * Math.PI) / 128),
      ] as [number, number],
    }));
    const entities = points.map((point, index) => ({
      id: `edge-${index}`,
      name: '界'.repeat(180),
      kind: 'line' as const,
      startId: point.id,
      endId: points[(index + 1) % points.length].id,
    }));
    const features = Array.from({ length: 24 }, (_, index) => ({
      id: `sketch-${index}`,
      name: `Sketch ${index}`,
      kind: 'sketch' as const,
      plane: 'xy' as const,
      sketch: {
        points: structuredClone(points),
        entities: structuredClone(entities),
        constraints: [],
        loops: [
          {
            id: 'outer',
            role: 'outer' as const,
            entityIds: entities.map((entity) => entity.id) as [string, ...string[]],
          },
        ],
      },
    }));
    project.geometry = {
      kind: 'cad',
      dimension: '2d',
      features: [features[0], ...features.slice(1)],
      outputFeatureId: features.at(-1)!.id,
      assets: [],
    };
    expect(validate(project), JSON.stringify(validate.errors)).toBe(true);
    expect(cadDefinitionError(project.geometry)).toBeNull();
    expect(documentSizeError(project)).toContain('1 MiB');
    expect(documentError(project)).toContain('1 MiB');
    expect(documentSizeError(blankProject())).toBeNull();
    expect(documentSizeError(makeProject())).toBeNull();
  });
  it('validates an actual empty SI document without supplying material, mesh or a study', () => {
    const project = blankProject('Future geometry', '2d');
    expect(validate(project), JSON.stringify(validate.errors)).toBe(true);
    expect(project.study).toBeNull();
    expect(isNumericalProject(project)).toBe(false);
    expect(documentPreparation(project).canRun).toBe(false);
    expect(documentPreparation(project).completed).toBe(0);
    expect(validateOld(project)).toBe(false);
    const old = { ...makeProject(), schemaVersion: 5 };
    expect(validateOld(old), JSON.stringify(validateOld.errors)).toBe(true);
    expect(validate(old)).toBe(false);
  });
  it('keeps a typed exact CAD source through study creation, undo and redo without inventing scientific completion', () => {
    const blank = blankProject();
    const geometry = structuredClone(blank);
    geometry.geometry = {
      kind: 'cad',
      dimension: '3d',
      features: [{ id: 'box', name: 'Box', kind: 'box', length: 0.1, width: 0.05, height: 0.02 }],
      outputFeatureId: 'box',
      assets: [],
    };
    const first = recordEdit(createHistory(blank), blank, geometry, true);
    const prepared: ProjectDefinition = structuredClone(first.project);
    prepared.study = makeProject().study;
    prepared.study.constraints = [];
    prepared.study.loads = [];
    const second = recordEdit(first.history, first.project, prepared, true);
    const reverted = undo(second.history, second.project);
    expect(reverted.project.geometry).toEqual(geometry.geometry);
    expect(reverted.project.study).toBeNull();
    expect(reverted.project.revision).toBeGreaterThan(second.project.revision);
    const restored = redo(reverted.history, reverted.project);
    expect(restored.project.study?.id).toBe(prepared.study.id);
    expect(restored.project.geometry).toEqual(geometry.geometry);
    expect(isNumericalProject(restored.project)).toBe(false);
    expect(documentPreparation(restored.project).canRun).toBe(false);
  });
  it('rejects DAG forward dependencies and untrusted frontend paths without blessing an unevaluated shape', () => {
    const project = blankProject();
    project.geometry = {
      kind: 'cad',
      dimension: '3d',
      features: [
        {
          id: 'extrude',
          name: 'Extrusion',
          kind: 'extrude',
          sketchId: 'future-sketch',
          distance: 0.1,
        },
      ],
      outputFeatureId: 'extrude',
      assets: [],
    };
    expect(cadDefinitionError(project.geometry)).toContain('later feature');
    const imported = {
      ...project,
      geometry: {
        kind: 'cad',
        dimension: '3d',
        features: [
          { id: 'step', name: 'Source', kind: 'import-step', assetId: 'source', scaleFactor: 1 },
        ],
        outputFeatureId: 'step',
        assets: [
          {
            id: 'source',
            kind: 'step-source',
            originalName: 'part.step',
            sha256: 'a'.repeat(64),
            byteLength: 10,
            path: '/arbitrary/developer/path',
          },
        ],
      },
    };
    expect(validate(imported)).toBe(false);
    delete (imported.geometry.assets[0] as { path?: string }).path;
    expect(validate(imported), JSON.stringify(validate.errors)).toBe(true);
  });
});
