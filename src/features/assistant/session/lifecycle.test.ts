import { expect, it, vi } from 'vitest';
import { sessionRetirement } from './lifecycle';

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

it('marks a pending turn cancelled only when the mounted session actually retires', async () => {
  const turn = { cancelled: false };
  const adopt = sessionRetirement(async () => {
    turn.cancelled = true;
  });
  adopt()();
  const realCleanup = adopt();
  await Promise.resolve();
  expect(turn.cancelled).toBe(false);
  realCleanup();
  await Promise.resolve();
  expect(turn.cancelled).toBe(true);
});
