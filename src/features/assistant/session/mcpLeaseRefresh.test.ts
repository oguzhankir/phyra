import { describe, expect, it, vi } from 'vitest';
import type { AssistantMcpConfiguration, AssistantSnapshot } from '../../../domain/assistant/types';
import { McpLeaseRefresher } from './mcpLeaseRefresh';

const snapshot = (): AssistantSnapshot => ({
  sessionId: 'session',
  projectId: null,
  revision: null,
  project: null,
  run: null,
  help: [],
  capabilities: [],
});
const revoked: AssistantMcpConfiguration = {
  enabled: false,
  protocolVersion: '2025-11-25',
  scopes: [],
  command: null,
  args: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let current = snapshot();
  let busy = false;
  const ports = {
    publish: vi.fn(async (_: AssistantSnapshot) => {}),
    revoke: vi.fn(async (_: string) => revoked),
    current: (value: AssistantSnapshot) => value === current,
    busy: () => busy,
    revoking: vi.fn(() => {
      busy = true;
    }),
    revoked: vi.fn((_value: AssistantMcpConfiguration) => {}),
    error: vi.fn((_message: string) => {}),
    settled: vi.fn(() => {
      busy = false;
    }),
  };
  return {
    ports,
    controller: new McpLeaseRefresher(ports),
    current: () => current,
    changeSnapshot: () => {
      current = snapshot();
    },
    busy: () => busy,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

describe('MCP snapshot leases', () => {
  it('revokes the current lease when its latest publication fails', async () => {
    const { controller, current, ports, busy } = fixture();
    ports.publish.mockRejectedValue(new Error('Invalid snapshot'));
    ports.revoke.mockImplementation(async () => {
      expect(busy()).toBe(true);
      return revoked;
    });
    await controller.refresh(current());
    expect(ports.revoke).toHaveBeenCalledWith('session');
    expect(ports.revoked).toHaveBeenCalledWith(revoked);
    expect(ports.error).toHaveBeenCalledWith(expect.stringContaining('was disconnected'));
    expect(busy()).toBe(false);
  });

  it('cannot revoke a newer successfully published snapshot because an older attempt failed', async () => {
    const { controller, current, ports } = fixture();
    const older = deferred<void>();
    ports.publish.mockImplementationOnce(() => older.promise);
    const pending = controller.refresh(current());
    await controller.refresh(current());
    older.reject(new Error('Old failure'));
    await pending;
    expect(ports.revoke).not.toHaveBeenCalled();
    expect(ports.error).not.toHaveBeenCalled();
  });

  it('ignores a failed publication after the host switches to another snapshot', async () => {
    const { controller, current, changeSnapshot, ports } = fixture();
    const older = deferred<void>();
    ports.publish.mockImplementationOnce(() => older.promise);
    const pending = controller.refresh(current());
    changeSnapshot();
    older.reject(new Error('Previous tab failed'));
    await pending;
    expect(ports.revoke).not.toHaveBeenCalled();
  });

  it('preserves a new explicit grant from older failed refreshes', async () => {
    const { controller, current, ports } = fixture();
    const older = deferred<void>();
    ports.publish.mockImplementationOnce(() => older.promise);
    const pending = controller.refresh(current());
    controller.invalidate();
    older.reject(new Error('Old grant failed'));
    await pending;
    expect(ports.revoke).not.toHaveBeenCalled();
    expect(ports.error).not.toHaveBeenCalled();
  });

  it('does not renew or revoke while an explicit configuration update owns the lock', async () => {
    const { controller, current, ports, setBusy } = fixture();
    setBusy(true);
    await controller.refresh(current());
    expect(ports.publish).not.toHaveBeenCalled();
    expect(ports.revoke).not.toHaveBeenCalled();
  });

  it('finishes a claimed revocation when the active tab changes during native revocation', async () => {
    const { controller, current, changeSnapshot, ports, busy } = fixture();
    const removal = deferred<AssistantMcpConfiguration>();
    ports.publish.mockRejectedValue(new Error('Invalid snapshot'));
    ports.revoke.mockImplementation(() => removal.promise);
    const pending = controller.refresh(current());
    await Promise.resolve();
    expect(busy()).toBe(true);
    changeSnapshot();
    await controller.refresh(current());
    expect(ports.publish).toHaveBeenCalledTimes(1);
    removal.resolve(revoked);
    await pending;
    expect(ports.revoked).toHaveBeenCalledWith(revoked);
    expect(busy()).toBe(false);
  });

  it('does not apply the result of a retiring host revocation', async () => {
    const { controller, current, ports, busy } = fixture();
    const removal = deferred<AssistantMcpConfiguration>();
    ports.publish.mockRejectedValue(new Error('Invalid snapshot'));
    ports.revoke.mockImplementation(() => removal.promise);
    const pending = controller.refresh(current());
    await Promise.resolve();
    controller.invalidate();
    removal.resolve(revoked);
    await pending;
    expect(ports.revoked).not.toHaveBeenCalled();
    expect(ports.error).not.toHaveBeenCalled();
    expect(busy()).toBe(false);
  });

  it('reports a revocation failure without claiming that access was disconnected', async () => {
    const { controller, current, ports, busy } = fixture();
    ports.publish.mockRejectedValue(new Error('Invalid snapshot'));
    ports.revoke.mockRejectedValue(new Error('Consent cannot be removed'));
    await controller.refresh(current());
    expect(ports.revoked).not.toHaveBeenCalled();
    expect(ports.error).toHaveBeenCalledWith(
      expect.stringContaining('Automatic disconnection failed'),
    );
    expect(busy()).toBe(false);
  });
});
