import { describe, expect, it } from 'vitest';
import type { AssistantMcpConfiguration } from '../../domain/assistant/types';
import { mcpClientConfiguration } from './mcpClientConfiguration';

const configuration: AssistantMcpConfiguration = {
  enabled: true,
  protocolVersion: '2025-11-25',
  tools: ['phyra_help'],
  command: '/Applications/Phyra App.app/Contents/MacOS/phyra',
  args: ['--mcp-read-only', 'session', 'native-token'],
};

describe('MCP client registration', () => {
  it('uses the VS Code servers format with its explicit stdio transport', () => {
    expect(JSON.parse(mcpClientConfiguration(configuration, 'vscode')!)).toEqual({
      servers: {
        phyra: { type: 'stdio', command: configuration.command, args: configuration.args },
      },
    });
  });

  it('uses the standard mcpServers format for Claude and compatible clients', () => {
    expect(JSON.parse(mcpClientConfiguration(configuration, 'other')!)).toEqual({
      mcpServers: { phyra: { command: configuration.command, args: configuration.args } },
    });
  });

  it('does not publish registration instructions for stopped or absent servers', () => {
    expect(mcpClientConfiguration(null, 'other')).toBeNull();
    expect(mcpClientConfiguration({ ...configuration, enabled: false }, 'vscode')).toBeNull();
    expect(mcpClientConfiguration({ ...configuration, command: null }, 'other')).toBeNull();
  });
});
