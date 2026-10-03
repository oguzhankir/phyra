import type { AssistantMcpConfiguration, AssistantSnapshot } from '../../../domain/assistant/types';
import { messageError } from './conversationTurn';

interface McpRefreshPorts {
  publish: (snapshot: AssistantSnapshot) => Promise<void>;
  revoke: (sessionId: string) => Promise<AssistantMcpConfiguration>;
  current: (snapshot: AssistantSnapshot) => boolean;
  busy: () => boolean;
  revoking: () => void;
  revoked: (configuration: AssistantMcpConfiguration) => void;
  error: (message: string) => void;
  settled: () => void;
}

/** A failed current refresh must not leave the preceding tab's lease accessible. */
export class McpLeaseRefresher {
  private attempt = 0;
  private authority = 0;

  constructor(private ports: McpRefreshPorts) {}

  // A manual grant/revocation or retiring host supersedes all older refreshes.
  invalidate() {
    this.authority++;
    this.attempt++;
  }

  async refresh(snapshot: AssistantSnapshot) {
    if (this.ports.busy() || !this.ports.current(snapshot)) return;
    const attempt = ++this.attempt;
    const authority = this.authority;
    try {
      await this.ports.publish(snapshot);
    } catch (failure) {
      if (
        attempt !== this.attempt ||
        authority !== this.authority ||
        !this.ports.current(snapshot) ||
        this.ports.busy()
      )
        return;
      // Claim the same busy lock as explicit configuration before issuing revoke.
      // Later snapshots may arrive, but cannot silently grant access again.
      this.ports.revoking();
      try {
        const configuration = await this.ports.revoke(snapshot.sessionId);
        if (authority !== this.authority) return;
        this.ports.revoked(configuration);
        this.ports.error(
          `MCP access was disconnected because the current snapshot could not be refreshed. Resolve the problem, then enable access again. ${messageError(failure)}`,
        );
      } catch (revocationFailure) {
        if (authority === this.authority)
          this.ports.error(
            `The shared snapshot is out of date. Automatic disconnection failed: ${messageError(revocationFailure)}. Disconnect MCP before using the client again.`,
          );
      } finally {
        this.ports.settled();
      }
    }
  }
}
