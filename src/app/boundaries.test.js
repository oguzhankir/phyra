import { describe, expect, it } from 'vitest';
import { boundaryViolation, checkBoundaries } from '../../scripts/check-boundaries.mjs';
describe('production dependency ownership', () => {
  it('validates actual static and dynamic imports in the current source', () => {
    expect(checkBoundaries()).toBeGreaterThan(40);
  });
  it('rejects lifecycle dependencies in domain, platform and reusable UI', () => {
    expect(
      boundaryViolation('src/domain/results/fields.ts', 'src/features/viewport/Viewport.tsx'),
    ).toBeTruthy();
    expect(
      boundaryViolation('src/platform/desktop/bridge.ts', 'src/app/useWorkbench.tsx'),
    ).toBeTruthy();
    expect(
      boundaryViolation('src/shared/forms/Input.tsx', 'src/features/project/Editor.tsx'),
    ).toBeTruthy();
    expect(
      boundaryViolation('src/features/project/Editor.tsx', 'src/app/useWorkbench.tsx'),
    ).toBeTruthy();
  });
  it('permits domain contracts and composition but keeps native APIs in platform', () => {
    expect(
      boundaryViolation(
        'src/domain/contracts/metadata.ts',
        'contracts/engine-capabilities.schema.json',
      ),
    ).toBeNull();
    expect(
      boundaryViolation('src/app/App.tsx', 'src/features/project/PropertyInspector.tsx'),
    ).toBeNull();
    expect(
      boundaryViolation('src/features/viewport/Viewport.tsx', '@tauri-apps/api/core'),
    ).toBeTruthy();
    expect(boundaryViolation('src/platform/desktop/bridge.ts', '@tauri-apps/api/core')).toBeNull();
  });
  it('isolates the assistant from host feature state while sharing versioned help', () => {
    expect(
      boundaryViolation(
        'src/features/assistant/session/useAssistantSession.ts',
        'src/features/project/PropertyInspector.tsx',
      ),
    ).toBeTruthy();
    expect(
      boundaryViolation('src/features/assistant/context.ts', 'src/features/help/content.ts'),
    ).toBeNull();
    expect(
      boundaryViolation(
        'src/features/assistant/session/useAssistantSession.ts',
        'src/platform/desktop/assistant.ts',
      ),
    ).toBeNull();
  });
});
