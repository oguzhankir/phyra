import { describe, expect, it } from 'vitest';
import { classifyProblem, validationProblem, warningProblem } from './problems';
describe('actionable problem presentation', () => {
  it('directs unconstrained systems to physical supports without concealing details', () => {
    const problem = classifyProblem('under-constrained: 6 rigid-body modes remain');
    expect(problem.section).toBe('constraints');
    expect(problem.details).toContain('6 rigid-body');
    expect(problem.message).toContain('intended physical');
  });
  it('preserves file inputs and recommends recovery rather than raw errors', () => {
    const problem = classifyProblem(new Error('Permission denied'), 'save');
    expect(problem.title).toBe('The project could not be saved');
    expect(problem.help).toBe('files');
    expect(problem.message).toContain('remain available');
  });
  it('treats invalid drafts as blocking input and numerical warnings as warnings', () => {
    expect(validationProblem('Incomplete numeric draft').severity).toBe('error');
    expect(warningProblem('Stress maximum may not converge', 0).severity).toBe('warning');
  });
  it('bounds unknown details and keeps a concrete settings action', () => {
    const problem = classifyProblem('z'.repeat(9000));
    expect(problem.details?.length).toBe(8000);
    expect(problem.action).toBe('Review settings');
  });
});
