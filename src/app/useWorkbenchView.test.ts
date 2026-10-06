import { describe, expect, it } from 'vitest';
import { blankProject } from '../domain/project/document';
import { adoptedWorkspaceMode } from './useWorkbenchView';
import { verificationProject } from './useVerificationWorkflow';

describe('adopted document presentation route', () => {
  it.each(['3d', '2d-compare', '2d-profile', '2d-energy'] as const)(
    'opens the analysis viewport when %s adopts a numerical definition into a blank document',
    (configuration) => {
      expect(adoptedWorkspaceMode(blankProject())).toBe('overview');
      expect(adoptedWorkspaceMode(verificationProject(configuration))).toBe('analysis');
    },
  );
  it('returns CAD and empty document adoption to the overview until an exact projection is available', () => {
    const project = blankProject();
    project.geometry = {
      kind: 'cad',
      dimension: '3d',
      features: [{ id: 'box', name: 'Box', kind: 'box', length: 0.1, width: 0.05, height: 0.025 }],
      outputFeatureId: 'box',
      assets: [],
    };
    project.study = verificationProject('3d').study;
    expect(adoptedWorkspaceMode(project)).toBe('overview');
    project.geometry = { kind: 'empty', dimension: '3d' };
    project.study = null;
    expect(adoptedWorkspaceMode(project)).toBe('overview');
  });
});
