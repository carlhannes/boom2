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

  console.log('Starting MCP servers...');

  // If no server configs are provided, return empty registry
  if (!serverConfigs) {
    console.log('No server configurations provided, skipping MCP server startup');
    return registry;
  }

  console.log(`Found ${Object.keys(serverConfigs).length} MCP server configurations to start`);

  try {
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
        console.log(`Setting up MCP server "${name}" with command: ${command} ${args?.join(' ') || ''}`);

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

        // Log environment variables if any
        if (env) {
          console.log(`MCP server "${name}" environment variables:`, env);
        }

        // Configure environment to force HTTP server mode
        const serverPort = 8000 + Math.floor(Math.random() * 1000);

        // Create a copy of the original args
        const serverArgs = [...(args || [])];

        // Add transport arguments directly to the command line args
        // This is critical - MCP servers prioritize command line arguments over env vars
        serverArgs.push('--transport', 'http');
        serverArgs.push('--port', serverPort.toString());
        serverArgs.push('--host', '0.0.0.0');

        console.log(`Starting MCP server "${name}" with command: "${fullCommand} ${serverArgs.join(' ')}", transport: http, port: ${serverPort}`);

        // Keep any existing environment variables from config, but don't add transport-related ones
        // as we're passing them as command line args instead
        const serverEnv = {
          ...process.env,
          ...env,
          DEBUG: 'mcp:*', // Enable MCP debug logging
        };

        console.log(`Server environment variables: ${JSON.stringify({ ...env, DEBUG: 'mcp:*' })}`);

        // Check if the command exists
        try {
          const checkPath = spawn('which', [fullCommand], { shell: true });
          checkPath.stdout.on('data', (data) => {
            console.log(`Command ${fullCommand} found at: ${data.toString().trim()}`);
          });
          checkPath.stderr.on('data', (data) => {
            console.error(`Error finding command ${fullCommand}: ${data.toString().trim()}`);
          });
        } catch (error) {
          console.error(`Error checking command ${fullCommand}:`, error);
        }

        // Start the server process with more verbose output
        console.log(`Spawning process: ${fullCommand} ${serverArgs.join(' ')}`);
        const serverProcess = spawn(fullCommand, serverArgs, {
          cwd: workingDir,
          stdio: 'pipe',
          shell: true,
          env: serverEnv,
        });

        // Use 0.0.0.0 for binding but localhost for client connections
        const serverUrl = `http://0.0.0.0:${serverPort}`;

        // Wait for server to start
        console.log(`Waiting for MCP server "${name}" to start...`);

        // Register the server with the registry
        registry.registerServer(name, serverUrl, serverProcess);

        // Handle process errors
        serverProcess.on('error', (error) => {
          console.error(`Failed to start server '${name}' (${command}):`, error);
        });

        // Monitor for process exit
        serverProcess.on('exit', (code, signal) => {
          console.error(`MCP server '${name}' exited with code ${code} and signal ${signal}`);
        });

        // Log stdout and stderr with enhanced debugging
        serverProcess.stdout.on('data', (data) => {
          const output = data.toString().trim();
          console.log(`[${name}] ${output}`);

          // Look for server startup messages
          if (output.includes('running on') || output.includes('listening')) {
            console.log(`MCP server "${name}" appears to be running.`);
          }
        });

        serverProcess.stderr.on('data', (data) => {
          console.error(`[${name}:ERROR] ${data.toString().trim()}`);
        });
      }
    }

    // Wait a second for servers to start up
    console.log('Waiting for MCP servers to initialize...');
    // Use void to indicate we're not interested in the return value
    await new Promise((resolve) => { setTimeout(resolve, 2000); });

    return registry;
  } catch (error: any) {
    console.error('Error starting MCP servers:', error.message || String(error));
    // Return the registry anyway, even if there were errors
    return registry;
  }
}
