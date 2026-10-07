import { describe, expect, it } from 'vitest';
import { makeProject } from '../features/examples/projects';
import { studyPreparationSourceKey } from './CanonicalProjectWorkspace';

describe('study preparation draft ownership', () => {
  it('revokes a draft after source geometry, document or study replacement', () => {
    const source = makeProject();
    const key = studyPreparationSourceKey(source);
    const geometry = structuredClone(source);
    geometry.geometry.length *= 2;
    expect(studyPreparationSourceKey(geometry)).not.toBe(key);
    const document = structuredClone(source);
    document.id = 'another-document';
    expect(studyPreparationSourceKey(document)).not.toBe(key);
    const study = structuredClone(source);
    study.study.id = 'another-study';
    expect(studyPreparationSourceKey(study)).not.toBe(key);
  });
  it('keeps the same source through harmless project name or revision changes', () => {
    const source = makeProject();
    const renamed = structuredClone(source);
    renamed.name = 'New project name';
    renamed.revision++;
    expect(studyPreparationSourceKey(renamed)).toBe(studyPreparationSourceKey(source));
  });
});
