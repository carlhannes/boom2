import { spawn } from 'child_process';
import { platform } from 'os';
import path from 'path';
import McpRegistry, { McpServerConfig } from './mcpRegistry';

/**
 * Start MCP servers from configurations
 *
 * @param serverConfigs MCP server configurations
 * @returns An initialized McpRegistry with running servers
 */
export default async function startMcpServers(
  serverConfigs?: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>,
): Promise<McpRegistry> {
  const registry = new McpRegistry();

  // If no server configs are provided, return empty registry
  if (!serverConfigs) {
    return registry;
  }

  // Register server configurations
  for (const [name, config] of Object.entries(serverConfigs)) {
    const serverConfig: McpServerConfig = {
      command: config.command,
      args: config.args,
      env: config.env,
    };

    registry.registerServerConfig(name, serverConfig);
  }

  // Get all registered servers and start them
  const servers = registry.getServers();
  for (const serverConfig of servers) {
    const {
      name, command, args, cwd, env,
    } = serverConfig;

    // Only process servers with a command
    if (command) {
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
        env: {
          ...process.env,
          ...env,
        },
      });

      // Default port for MCP servers (this is just a placeholder - in reality we would
      // need to start at a base port and increment or check for available ports)
      const serverPort = 8000 + Math.floor(Math.random() * 1000);
      const serverUrl = `http://localhost:${serverPort}`;

      // Register the server with the registry
      registry.registerServer(name, serverUrl, serverProcess);

      // Handle process errors
      serverProcess.on('error', (error) => {
        console.error(`Failed to start server '${name}' (${command}):`, error);
      });

      // Log stdout and stderr
      serverProcess.stdout.on('data', (data) => {
        console.log(`[${name}] ${data.toString().trim()}`);
      });

      serverProcess.stderr.on('data', (data) => {
        console.error(`[${name}] ${data.toString().trim()}`);
      });
    }
  }

  return registry;
}
