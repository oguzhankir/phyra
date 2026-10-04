import type { AssistantMcpConfiguration } from '../../domain/assistant/types';

export type McpClient = 'vscode' | 'other';

/** Host configuration formats share only the application-owned stdio command. */
export function mcpClientConfiguration(
  configuration: AssistantMcpConfiguration | null,
  client: McpClient,
): string | null {
  if (!configuration?.enabled || !configuration.command) return null;
  const server = { command: configuration.command, args: configuration.args };
  return JSON.stringify(
    client === 'vscode'
      ? { servers: { phyra: { type: 'stdio', ...server } } }
      : { mcpServers: { phyra: server } },
    null,
    2,
  );
}
