import type { Operation } from '../../domain/contracts/types';
import type { Section } from '../workbench/navigation';
export type ProblemSeverity = 'error' | 'warning' | 'info';
export type Problem = {
  id: string;
  severity: ProblemSeverity;
  title: string;
  message: string;
  details?: string;
  section?: Section;
  help?: 'conditions' | 'mesh' | 'solver' | 'files' | 'results';
  action: string;
};
export type ProblemOperation = Operation | 'save' | 'open' | 'export' | 'reference' | 'recovery';
export function classifyProblem(cause: unknown, operation?: ProblemOperation): Problem {
  const details = (cause instanceof Error ? cause.message : String(cause)).slice(0, 8000);
  const text = details.toLowerCase();
  const base = { id: 'operation', severity: 'error' as const, details };
  if (text.startsWith('recovery cleanup:'))
    return {
      ...base,
      severity: 'warning',
      title: text.includes('opened project')
        ? 'The opened project is active'
        : 'The recovered project is active',
      message:
        'An earlier recovery copy could not be removed and is preserved. The active project remains available; review recovery copies after saving.',
      help: 'files',
      action: 'Recovery help',
    };
  if (/under.constrain|rigid.body|singular/.test(text))
    return {
      ...base,
      title: 'The model can move without resistance',
      message:
        'Review the supports and constrain the required rigid-body motion. Do not add restraints that change the intended physical problem.',
      section: 'constraints',
      help: 'conditions',
      action: 'Review supports',
    };
  if (
    /out.of.memory|memory|resource.limit|too many|exceeds.*(nodes|cells|triangles)|budget/.test(
      text,
    )
  )
    return {
      ...base,
      title: 'The job exceeds the supported resource budget',
      message:
        'Use a larger element size or reduce the model or training sample count, then run again.',
      section: operation === 'train' ? 'solver' : 'mesh',
      help: 'mesh',
      action: 'Review discretization',
    };
  if (/geometry|bracket|dimension/.test(text) && !/dimensionless/.test(text))
    return {
      ...base,
      title: 'The domain dimensions need attention',
      message: 'Check finite, positive dimensions and the supported primitive shape limits.',
      section: 'geometry',
      help: 'mesh',
      action: 'Review geometry',
    };
  if (/each support|support needs|boundary.*support/.test(text))
    return {
      ...base,
      title: 'Support assignment is incomplete',
      message: 'Assign boundaries and at least one prescribed displacement component.',
      section: 'constraints',
      help: 'conditions',
      action: 'Review supports',
    };
  if (/poisson|young|material/.test(text))
    return {
      ...base,
      title: 'Material properties need attention',
      message: 'Check the elastic properties and the supported formulation range.',
      section: 'material',
      help: 'solver',
      action: 'Review material',
    };
  if (/invalid.*(draft|numeric)|incomplete.*numeric|complete.*numeric/.test(text))
    return {
      ...base,
      title: 'Complete the numeric input',
      message:
        'Finish the highlighted number, or press Escape in that field to revert. The last valid value will not be submitted while the draft is invalid.',
      action: 'Review input',
    };
  if (/device|cuda|mps|accelerator/.test(text))
    return {
      ...base,
      title: 'The execution device is unavailable',
      message: 'Refresh the device list and choose an available device. CPU uses double precision.',
      section: 'solver',
      help: 'solver',
      action: 'Review device',
    };
  if (/mesh|gmsh|element|tetra|triang/.test(text))
    return {
      ...base,
      title: 'Meshing or discretization failed',
      message:
        'Check the domain dimensions and element size. Review the technical details before changing the physical model.',
      section: 'mesh',
      help: 'mesh',
      action: 'Review mesh',
    };
  if (
    operation === 'save' ||
    operation === 'open' ||
    operation === 'export' ||
    /archive|project file|permission|read.only/.test(text)
  )
    return {
      ...base,
      title:
        operation === 'save'
          ? 'The project could not be saved'
          : 'The file operation could not finish',
      message:
        'Your current inputs remain available. Check the destination and file permissions; save to another location if necessary.',
      help: 'files',
      action: 'Project file help',
    };
  if (operation === 'recovery' || /recovery|checkpoint|journal/.test(text))
    return {
      ...base,
      title: 'Recovery protection needs attention',
      message:
        'Keep the workbench open and save the project manually. Existing recovery copies are preserved.',
      help: 'files',
      action: 'Recovery help',
    };
  if (operation === 'reference' || /reference result/.test(text))
    return {
      ...base,
      title: 'The saved reference could not be loaded',
      message:
        'The previous project is preserved. Reload the preview and inspect the reference again.',
      help: 'results',
      action: 'Reference result help',
    };
  return {
    ...base,
    title: 'The operation could not finish',
    message:
      'Review the job settings and the technical details. Your current project is preserved; retry after addressing the cause.',
    section: 'solver',
    help: 'solver',
    action: 'Review settings',
  };
}
export function validationProblem(message: string): Problem {
  const problem = classifyProblem(message);
  return {
    ...problem,
    id: 'validation',
    title: 'Input requires attention',
    message,
    details: undefined,
    severity: 'error',
  };
}
export function warningProblem(message: string, index: number): Problem {
  return {
    id: `warning-${index}`,
    severity: 'warning',
    title: 'Result interpretation',
    message,
    help: 'results',
    action: 'Interpretation guide',
  };
}
