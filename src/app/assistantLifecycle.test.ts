import { expect, it, vi } from 'vitest';
import { sessionRetirement } from './assistantLifecycle';

it('retains the same native session through StrictMode effect replay, retiring on unmount', async () => {
  const release = vi.fn(async () => {});
  const adopt = sessionRetirement(release);
  const firstCleanup = adopt();
  firstCleanup();
  const realCleanup = adopt();
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  realCleanup();
  await Promise.resolve();
  expect(release).toHaveBeenCalledTimes(1);
});
