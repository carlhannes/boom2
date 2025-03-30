import { spawn } from 'child_process';
import { platform } from 'os';
import path from 'path';
import McpRegistry from './mcpRegistry';

/**
 * Start MCP servers specified in a registry
 *
 * @param registry The MCP registry containing server configurations
 * @returns An array of server processes
 */
export default async function startMcpServers(registry: McpRegistry): Promise<any[]> {
  const servers = [];
  const serverConfigs = registry.getServers();

  for (const config of serverConfigs) {
    const { command, args, cwd } = config;

    // Skip servers without a command
    if (!command) {
      continue;
    }

    // Determine the full command path
    let fullCommand = command;
    if (platform() === 'win32' && !command.endsWith('.exe')) {
      fullCommand = `${command}.exe`;
    }

    // Resolve relative paths if needed
    let workingDir = cwd;
    if (workingDir && !path.isAbsolute(workingDir)) {
      workingDir = path.resolve(process.cwd(), workingDir);
    }

    // Start the server process
    const serverProcess = spawn(fullCommand, args || [], {
      cwd: workingDir,
      stdio: 'pipe',
      shell: true,
    });

    // Handle process errors
    serverProcess.on('error', (error) => {
      console.error(`Failed to start server '${command}':`, error);
    });

    // Log stdout and stderr
    serverProcess.stdout.on('data', (data) => {
      console.log(`[${command}] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[${command}] ${data.toString().trim()}`);
    });

    // Add to server list
    servers.push(serverProcess);
  }

  return servers;
}
