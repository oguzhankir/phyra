import { invoke } from '@tauri-apps/api/core';
import { expect, it, vi } from 'vitest';
import type { AssistantSnapshot } from '../../domain/assistant/types';
import { publishAssistantSnapshot, releaseAssistantSession } from './assistant';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));

it('orders overlapping snapshot publications per session before either native call completes', async () => {
  const pending: (() => void)[] = [];
  vi.mocked(invoke).mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
  const snapshot: AssistantSnapshot = {
    sessionId: 'session-a',
    projectId: null,
    revision: null,
    project: null,
    run: null,
    help: [],
    capabilities: [],
  };
  const first = publishAssistantSnapshot(snapshot);
  const second = publishAssistantSnapshot({ ...snapshot, revision: 2 });
  const other = publishAssistantSnapshot({ ...snapshot, sessionId: 'session-b' });
  expect(vi.mocked(invoke).mock.calls.map(([, args]) => args)).toMatchObject([
    { publicationSequence: 1 },
    { publicationSequence: 2 },
    { publicationSequence: 1 },
  ]);
  // Native completion order is independent of the order stamped at invocation.
  pending[1]();
  await second;
  pending[0]();
  pending[2]();
  await Promise.all([first, other]);
  vi.mocked(invoke).mockResolvedValue(undefined);
  await releaseAssistantSession(snapshot.sessionId);
  expect(vi.mocked(invoke).mock.lastCall).toEqual([
    'assistant_release_session',
    { sessionId: snapshot.sessionId },
  ]);
});
