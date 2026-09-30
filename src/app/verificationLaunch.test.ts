import { describe, expect, it } from 'vitest';
import { verificationLaunch } from './verificationLaunch';

describe('verification startup waits for execution readiness', () => {
  it.each(['solve', 'compare'] as const)(
    'waits for gates, dispatches %s once, then ignores repeated render/effect setup',
    (operation) => {
      let started = false;
      const submissions: string[] = [];
      const render = (configuration: typeof operation | null, blocked: boolean) => {
        const action = verificationLaunch(configuration, started, blocked);
        if (action) {
          started = true;
          submissions.push(action);
        }
      };
      // Configuration resolution and native inventory completion can occur in
      // either order. An early blocked render must remain eligible to launch.
      render(null, true);
      render(operation, true);
      render(operation, true);
      expect(started).toBe(false);
      expect(submissions).toEqual([]);
      render(operation, false);
      expect(submissions).toEqual([operation]);
      render(operation, false);
      render(operation, true);
      render(operation, false);
      expect(submissions).toEqual([operation]);
    },
  );
  it('does not submit a default solve while configuration is still unresolved', () => {
    expect(verificationLaunch(null, false, true)).toBeNull();
    expect(verificationLaunch(null, false, false)).toBeNull();
    expect(verificationLaunch('compare', false, false)).toBe('compare');
  });
  it('waits if another readiness gate closes before the first dispatch', () => {
    expect(verificationLaunch('solve', false, true)).toBeNull();
    expect(verificationLaunch('solve', false, true)).toBeNull();
    expect(verificationLaunch('solve', false, false)).toBe('solve');
  });
  it('does not launch a second configured operation after startup was consumed', () => {
    expect(verificationLaunch('solve', true, false)).toBeNull();
    expect(verificationLaunch('compare', true, false)).toBeNull();
    expect(verificationLaunch(null, true, false)).toBeNull();
  });
});
