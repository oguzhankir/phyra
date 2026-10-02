import { describe, expect, it } from 'vitest';
import savedProject from '../../public/reference/three-dimensional.project.json';
import savedManifest from '../../public/reference/three-dimensional.manifest.json';
import type { Manifest, Project } from '../domain/contracts/types';
import type { ResultData } from '../domain/results/fields';
import { prepareStudy } from '../domain/project/readiness';
import { assistantContext } from '../features/assistant/context';
import { assistantStudyContext } from './assistantStudyContext';
import type { ProjectDocumentSnapshot } from './projectDocuments';

const project = savedProject as Project;
const manifest = savedManifest as unknown as Manifest;
function active(changes: Partial<ProjectDocumentSnapshot> = {}) {
  return {
    documentId: 'reference-document',
    project,
    section: 'results',
    preparation: prepareStudy(project),
    currentData: { manifest, buffer: new ArrayBuffer(0) } as ResultData,
    runExecution: null,
    runStatus: 'completed',
    progress: null,
    error: null,
    ...changes,
  } as ProjectDocumentSnapshot;
}
describe('exact assistant study and retained result provenance', () => {
  it('attaches the actual reference summary and identities without buffers or archive paths', () => {
    const study = assistantStudyContext(active())!;
    const context = assistantContext('Explain this result', study, true);
    expect(context).toMatchObject({
      kind: 'study',
      projectId: project.id,
      studyId: project.study.id,
      revision: project.revision,
    });
    expect(context.text).toContain(manifest.jobId);
    expect(context.text).toContain(manifest.fingerprint);
    expect(context.text).toContain(String(manifest.summary!.maxDisplacement));
    expect(context.text).not.toContain('"arrays"');
    expect(context.text).not.toContain('"buffer"');
    expect(context.text).toContain('"state": "current-for-inputs"');
  });
  it('documentation-only context excludes even the active project identity', () => {
    const privateProject = { ...project, id: 'private-identity', name: 'Private geometry name' };
    const context = assistantContext(
      'How do I start?',
      assistantStudyContext(active({ project: privateProject })),
      false,
    );
    expect(context.kind).toBe('help');
    expect(context.projectId).toBeNull();
    expect(context.text).not.toContain(privateProject.id);
    expect(context.text).not.toContain(privateProject.name);
    expect(context.text).not.toContain(manifest.jobId);
  });
  it('retains old fields separately, without inventing an ID for a preparing attempt', () => {
    const next = { ...project, revision: project.revision + 1 };
    const study = assistantStudyContext(
      active({
        project: next,
        runStatus: 'preparing',
        runExecution: { project: next, operation: 'solve' },
      }),
    )!;
    expect(study.run).toBeNull();
    expect(study.manifest).toBe(manifest);
    const text = assistantContext('What is running?', study, true).text;
    expect(text).toContain('"latestJob": false');
    expect(text).toContain('"state": "stale"');
  });
  it('never attributes preceding numerical values or fingerprint to a new running job', () => {
    const next = { ...project, revision: project.revision + 1 };
    const study = assistantStudyContext(
      active({
        project: next,
        runStatus: 'running',
        runExecution: { project: next, operation: 'solve', jobId: 'new-test-job' },
      }),
    )!;
    expect(study.run).toMatchObject({
      jobId: 'new-test-job',
      state: 'running',
      inputFingerprint: null,
    });
    expect(JSON.parse(study.run!.summary).summary).toBeNull();
    expect(study.run!.summary).not.toContain(manifest.fingerprint);
    expect(study.run!.summary).not.toContain(String(manifest.summary!.maxDisplacement));
  });
  it('labels retained failed and cancelled attempts with their own identity', () => {
    for (const state of ['failed', 'cancelled'] as const) {
      const study = assistantStudyContext(
        active({
          runStatus: state,
          runExecution: { project, operation: 'solve', jobId: `test-${state}` },
        }),
      )!;
      expect(study.run!.state).toBe(state);
      expect(study.run!.inputFingerprint).toBeNull();
      expect(study.manifest!.jobId).toBe(manifest.jobId);
    }
  });
});
