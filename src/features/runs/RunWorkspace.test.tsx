import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeProject } from '../examples/projects';
import type { Manifest, Project } from '../../domain/contracts/types';
import RunWorkspace from './RunWorkspace';

function energyResult(project: Project): Manifest {
  return {
    jobId: 'energy-completed',
    operation: 'train',
    durationSeconds: 2,
    training: {
      configuration: { ...project.study.solver.pinn, formulation: 'potential-energy' },
      device: 'cpu',
      precision: 'float64',
      timings: { trainingSeconds: 1.8, inferenceSeconds: 0.2 },
      history: [0, 2].map((step) => ({
        jobId: 'energy-completed',
        step,
        elapsed: step,
        total: 0.1,
        pde: 0.08,
        boundary: 0.02,
        device: 'cpu',
      })),
      energy: {
        schemaVersion: 1,
        definition: 'Potential = strain energy minus external work',
        trainingQuadrature: 'Three-point weighted triangles',
        auditQuadrature: 'Subdivided weighted triangles',
        interiorPoints: 24,
        boundaryPoints: 32,
        physicalScale: 0.002,
        history: [
          { step: 0, potential: 0, strain: 0, work: 0 },
          { step: 2, potential: -0.75, strain: 0.75, work: 1.5 },
        ],
        audit: { potential: -0.7421875, strain: 0.7578125, work: 1.5 },
        relativeIntegrationDifference: 1 / 192,
      },
    },
  } as Manifest;
}
function render(project: Project, manifest: Manifest, status: 'idle' | 'preparing' = 'idle') {
  return renderToStaticMarkup(
    <RunWorkspace
      project={project}
      manifest={manifest}
      history={[]}
      status={status}
      execution={status === 'preparing' ? { project, operation: 'train', jobId: 'new-job' } : null}
      elapsed={0}
      tab="training"
      onTab={() => {}}
      expanded
      onToggle={() => {}}
    />,
  );
}
it('reports a published signed objective and physical audit separately from residual diagnostics', () => {
  const project = makeProject('plane-stress-tension');
  project.study.solver.pinn.formulation = 'potential-energy';
  const markup = render(project, energyResult(project));
  expect(markup).toContain('Total residual diagnostic');
  expect(markup).toContain('Signed potential-energy objective');
  expect(markup).toContain('-0.0014844 J');
  expect(markup).toContain('Finer integration audit');
  expect(markup).toContain('not a field-error bound');
  expect(markup).toContain('Subdivided weighted triangles');
});
it('keeps a previous completed energy objective out of a new preparing run', () => {
  const project = makeProject('plane-stress-tension');
  project.study.solver.pinn.formulation = 'potential-energy';
  const markup = render(project, energyResult(project), 'preparing');
  expect(markup).toContain('after a successful run');
  expect(markup).not.toContain('Signed potential-energy objective');
  expect(markup).not.toContain('-0.0014844 J');
  expect(markup).toContain('previous result');
});
it('preserves strong-form loss reporting for old saved runs', () => {
  const project = makeProject('plane-stress-tension');
  const result = energyResult(project);
  result.training!.configuration.formulation = 'strong-form';
  delete result.training!.energy;
  const markup = render(project, result);
  expect(markup).toContain('Total loss');
  expect(markup).toContain('PINN training losses');
  expect(markup).not.toContain('Potential-energy objective');
});
