import { describe, expect, it } from 'vitest';
import { makeProject } from '../../features/examples/projects';
import { recoveryEligible, recoverySnapshot } from './recovery';
describe('definition-only recovery eligibility', () => {
  it('suspends checkpointing invalid drafts and invalid physical definitions', () => {
    const project = makeProject('cantilever');
    expect(recoveryEligible(project, true, 0)).toBe(true);
    expect(recoveryEligible(project, true, 1)).toBe(false);
    project.study.material.young = 0;
    expect(recoveryEligible(project, true, 0)).toBe(false);
  });
  it('never mutates the active definition or treats a clean file as unsaved', () => {
    const project = makeProject('cantilever');
    expect(recoveryEligible(project, false, 0)).toBe(false);
    const snapshot = recoverySnapshot(project);
    snapshot.geometry.length = 99;
    expect(project.geometry.length).not.toBe(99);
    expect(snapshot.id).toBe(project.id);
    expect(snapshot.revision).toBe(project.revision);
  });
});
