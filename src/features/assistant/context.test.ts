import { expect, it } from 'vitest';
import type { CadFeature, ProjectDefinition } from '../../domain/contracts/types';
import { blankProject, documentPreparation } from '../../domain/project/document';
import { isCadSolidProject } from '../../domain/project/cadSolid';
import { prepareStudy } from '../../domain/project/readiness';
import { makeProject } from '../examples/projects';
import { ASSISTANT_SYSTEM, assistantContext, type AssistantStudyContext } from './context';

const features: [CadFeature, ...CadFeature[]] = [
  { id: 'source', name: 'Shared source', kind: 'box', length: 0.1, width: 0.02, height: 0.01 },
  {
    id: 'placement',
    name: 'Second component placement',
    kind: 'transform',
    inputId: 'source',
    translation: [0.2, 0, 0],
    axisOrigin: [0, 0, 0],
    axisDirection: [0, 0, 1],
    angle: 0,
  },
  {
    id: 'assembly',
    name: 'Private assembly',
    kind: 'assembly',
    components: [
      { id: 'instance-a', name: 'First instance', featureId: 'source' },
      { id: 'instance-b', name: 'Second instance', featureId: 'placement' },
    ],
  },
];

function assemblyContext(): AssistantStudyContext {
  const project: ProjectDefinition = {
    ...blankProject('Private component project'),
    id: 'private-assembly-project',
    revision: 4,
    geometry: { kind: 'cad', dimension: '3d', assets: [], features, outputFeatureId: 'assembly' },
  };
  return {
    documentId: 'assembly-document',
    project,
    section: 'cad',
    preparation: documentPreparation(project),
    manifest: null,
    run: null,
    error: null,
    cad: {
      state: 'current',
      dimension: '3d',
      outputFeatureId: 'assembly',
      featureCount: 3,
      sketchCount: 0,
      assetCount: 0,
      evaluation: {
        jobId: 'synthetic-cad-fixture-job',
        revision: 4,
        geometryFingerprint: 'a'.repeat(64),
        outputFeatureId: 'assembly',
        summary: JSON.stringify({
          analysisCompatibility: {
            state: 'unsupported',
            methodIds: [],
            reason: 'No compatible assembly adapter.',
          },
        }),
      },
    },
  };
}

it('preserves authored assembly instance/source identities with separate unsupported CAD evidence', () => {
  const context = assistantContext(
    'Explain my assembly components and placements.',
    assemblyContext(),
    true,
  );
  expect(context.kind).toBe('project');
  expect(context.studyId).toBeNull();
  expect(context.sourceIds).toContain('cad-assembly');
  expect(context.text).toContain('"schemaVersion": 8');
  expect(context.text).toContain('"id": "instance-a"');
  expect(context.text).toContain('"id": "instance-b"');
  expect(context.text).toContain('"featureId": "placement"');
  expect(context.text).toContain('synthetic-cad-fixture-job');
  expect(context.text).toContain('unsupported');
  expect(context.text).toContain('"result": null');
  expect(context.text).not.toContain('"triangles"');
  expect(ASSISTANT_SYSTEM).toContain('Visual overlap does not imply');
  expect(ASSISTANT_SYSTEM).toContain('shells and assemblies remain unsupported');
});

it('keeps private advanced CAD definitions and evaluation evidence out of help-only questions', () => {
  const context = assistantContext('How do assembly placements work?', assemblyContext(), false);
  expect(context.sourceIds).toContain('cad-assembly');
  expect(context.kind).toBe('help');
  expect(context.text).not.toContain('private-assembly-project');
  expect(context.text).not.toContain('Private component project');
  expect(context.text).not.toContain('instance-a');
  expect(context.text).not.toContain('synthetic-cad-fixture-job');
});

it('uses English guidance with multilingual retrieval without implying screen access', () => {
  const context = assistantContext('Montaj bileşenlerini nasıl taşırım?', assemblyContext(), true);
  expect(context.sourceIds).toContain('cad-assembly');
  expect(context.text).toContain('Create > Assembly');
  expect(context.text).toContain(
    'CAD viewport selection, camera position and open panels are not included',
  );
  expect(ASSISTANT_SYSTEM).toContain('Always respond in English');
  expect(ASSISTANT_SYSTEM).toContain(
    'Preserve supplied feature names, identifiers and quoted values exactly',
  );
  expect(ASSISTANT_SYSTEM).not.toContain("Answer in the user's language");
  expect(ASSISTANT_SYSTEM).toContain('do not claim to see a highlighted face');
});

it('separates guidance about a pending command from the supplied committed CAD evidence', () => {
  const context = assistantContext(
    'Can I analyze the provisional CAD preview before I apply it?',
    assemblyContext(),
    true,
  );
  expect(context.sourceIds[0]).toBe('cad');
  expect(context.text).toContain('Apply becomes available only after an exact preview succeeds');
  expect(context.text).toContain('Cancel leaves the project definition unchanged');
  expect(context.text).toContain(
    'Unapplied command drafts, provisional previews and transient mesh inspection data are not attached',
  );
  expect(context.text).toContain('synthetic-cad-fixture-job');
  expect(ASSISTANT_SYSTEM).toContain(
    'Never cite an older committed CAD evaluation as evidence for an unapplied command',
  );
  expect(ASSISTANT_SYSTEM).toContain('Apply needs a committed rebuild');
});

it('explains transient mesh inspection without treating it as study or supplied evidence', () => {
  const context = assistantContext(
    'How can I inspect tetrahedral mesh quality in CAD?',
    assemblyContext(),
    false,
  );
  expect(context.sourceIds).toContain('cad');
  expect(context.text).toContain('Mean-ratio tetrahedral quality');
  expect(context.text).toContain('No boundary assignments are saved');
  expect(context.text).not.toContain('private-assembly-project');
  expect(ASSISTANT_SYSTEM).toContain(
    'Transient mesh previews, correspondence reports, selections and quality measurements are not supplied',
  );
});

it('supplies authored CAD face assignments while keeping missing source verification explicit', () => {
  const context = assemblyContext();
  const base = makeProject('cantilever');
  context.project = {
    ...base,
    geometry: {
      kind: 'cad',
      dimension: '3d',
      assets: [],
      features: [features[0]],
      outputFeatureId: 'source',
    },
    study: {
      ...base.study,
      domain: {
        kind: 'cad-solid',
        geometryFingerprint: 'd'.repeat(64),
        outputFeatureId: 'source',
        boundaries: [
          { id: 'support-face', faceId: `source/face/${'1'.repeat(24)}`, name: 'Support face' },
          { id: 'load-face', faceId: `source/face/${'2'.repeat(24)}`, name: 'Load face' },
        ],
      },
      constraints: [{ ...base.study.constraints[0], regions: ['support-face'] }],
      loads: [{ ...base.study.loads[0], regions: ['load-face'] }],
    },
  };
  if (!isCadSolidProject(context.project)) throw new Error('Expected CAD study fixture');
  context.preparation = prepareStudy(context.project);
  context.cad = null;
  const attached = assistantContext('How do I prepare my CAD solid for FEM?', context, true);
  expect(attached.kind).toBe('study');
  expect(attached.studyId).toBe(base.study.id);
  expect(attached.text).toContain('"kind": "cad-solid"');
  expect(attached.text).toContain(`source/face/${'2'.repeat(24)}`);
  expect(attached.text).toContain('"load-face"');
  expect(attached.text).toContain('Rebuild the exact CAD geometry');
  expect(attached.text).toContain('"result": null');
  expect(attached.text).toContain('Prepare analysis');
  expect(ASSISTANT_SYSTEM).toContain(
    'a saved domain catalog alone does not prove current source verification',
  );
  const helpOnly = assistantContext('How do I prepare a CAD solid for FEM?', context, false);
  expect(helpOnly.text).not.toContain(`source/face/${'2'.repeat(24)}`);
  expect(helpOnly.studyId).toBeNull();
});
