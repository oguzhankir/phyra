import { describe, expect, it, vi } from 'vitest';
import { prepareStudy } from '../domain/project/readiness';
import { inputError } from '../domain/project/validation';
import { makeProject } from '../features/examples/projects';
import { createWorkbenchCommands } from './workbenchCommands';

function model() {
  const project = makeProject();
  return {
    project,
    isPinn: false,
    locked: false,
    nativeLocked: false,
    preparation: prepareStudy(project),
    desktop: true,
    validation: inputError(project),
    solved: false,
    selectSection: vi.fn(),
    create: vi.fn(async () => true),
    open: vi.fn(async () => true),
    save: vi.fn(async () => true),
    execute: vi.fn(async () => {}),
    exportFields: vi.fn(async () => {}),
    showHelp: vi.fn(),
  };
}

describe('document command availability', () => {
  it('allows mesh preparation with missing conditions and gates solution on readiness', () => {
    const commands = createWorkbenchCommands(model());
    expect(commands.find((item) => item.id === 'generate-mesh')?.disabled).toBe(false);
    expect(commands.find((item) => item.id === 'run')?.disabled).toBe(true);
    expect(commands.find((item) => item.id === 'save')?.disabled).toBe(false);
  });

  it('serializes native actions while retaining document navigation', () => {
    const commands = createWorkbenchCommands({ ...model(), nativeLocked: true });
    for (const id of ['open', 'save', 'generate-mesh', 'run', 'export'])
      expect(commands.find((item) => item.id === id)?.disabled).toBe(true);
    expect(commands.find((item) => item.id === 'geometry')?.disabled).toBeUndefined();
  });

  it('dispatches run to the same guarded owner used by the workbench', () => {
    const current = model();
    current.project = makeProject('cantilever');
    current.preparation = prepareStudy(current.project);
    const commands = createWorkbenchCommands(current);
    const run = commands.find((item) => item.id === 'run');
    expect(run?.disabled).toBe(false);
    run?.action();
    expect(current.execute).toHaveBeenCalledWith('solve');
  });
});
