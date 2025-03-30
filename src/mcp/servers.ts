import { spawn } from 'child_process';
import { platform } from 'os';
import path from 'path';
import axios from 'axios';
import chalk from 'chalk';
import McpRegistry, { McpServerConfig } from './mcpRegistry';

/**
 * Helper to check if a server is responding on a given URL
 * @param url The server URL to check
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelay Initial delay between retries (ms)
 * @returns A promise that resolves when the server is ready
 */
async function waitForServerReady(url: string, maxRetries = 10, initialDelay = 500): Promise<boolean> {
  let retryCount = 0;
  let currentDelay = initialDelay;

  while (retryCount < maxRetries) {
    try {
      console.log(chalk.gray(`Checking server health at ${url} (attempt ${retryCount + 1}/${maxRetries})...`));
      // Try to access the tools endpoint to verify server is up and running
      const response = await axios.get(`${url}/tools`, { timeout: 5000 });

      if (response.status === 200 && response.data && response.data.tools) {
        console.log(chalk.green(`✓ Server at ${url} is ready with ${response.data.tools.length} tools available`));
        return true;
      }

      console.log(chalk.yellow(`Server at ${url} responded but didn't return tools, retrying...`));
    } catch (error) {
      console.log(chalk.yellow(`Server at ${url} not ready yet (${(error as Error).message})`));
    }

    // Exponential backoff with maximum of 10 seconds
    currentDelay = Math.min(currentDelay * 1.5, 10000);
    retryCount += 1;

    // Wait before next retry
    await new Promise((resolve) => setTimeout(resolve, currentDelay));
  }

  console.error(chalk.red(`Failed to connect to server at ${url} after ${maxRetries} attempts`));
  return false;
}

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

  console.log(chalk.blue('Starting MCP servers...'));

  // If no server configs are provided, return empty registry
  if (!serverConfigs) {
    console.log(chalk.yellow('No server configurations provided, skipping MCP server startup'));
    return registry;
  }

  console.log(chalk.blue(`Found ${Object.keys(serverConfigs).length} MCP server configurations to start`));

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
    const startupPromises = [];

    for (const serverConfig of servers) {
      const {
        name, command, args, cwd, env,
      } = serverConfig;

      // Only process servers with a command
      if (command) {
        // Start this server and add the promise to our array
        startupPromises.push(startServer(registry, name, command, args || [], cwd, env));
      }
    }

    // Wait for all servers to start (or fail)
    const results = await Promise.allSettled(startupPromises);

    // Count successful startups
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    console.log(chalk.blue(`Started ${successCount}/${startupPromises.length} MCP servers successfully`));

    if (successCount === 0 && startupPromises.length > 0) {
      console.error(chalk.red('Failed to start any MCP servers. Please check your configuration.'));
    }

    return registry;
  } catch (error: any) {
    console.error(chalk.red('Error starting MCP servers:'), error.message || String(error));
    // Return the registry anyway, even if there were errors
    return registry;
  }
}

/**
 * Starts a single MCP server and registers it with the registry
 */
async function startServer(
  registry: McpRegistry,
  name: string,
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<void> {
  try {
    console.log(chalk.blue(`Setting up MCP server "${name}" with command: ${command} ${args.join(' ')}`));

    // Create a copy of the original args and add transport settings
    const serverArgs = [...args];

    // Check if we're running an npx command with MCP server
    const isNpx = command === 'npx';
    const mcpServerIndex = isNpx ? serverArgs.findIndex((arg) => arg.includes('@modelcontextprotocol/server-')
      || arg.includes('mcp-server-')) : -1;

    // Add transport arguments directly to the command line args
    // For npx commands, we need to add them after the server name but before its arguments
    if (isNpx && mcpServerIndex >= 0) {
      // For npx commands, insert transport args after the package name
      serverArgs.splice(
        mcpServerIndex + 1,
        0,
        '--transport',
        'http',
        '--port',
        (8000 + Math.floor(Math.random() * 1000)).toString(),
        '--host',
        '0.0.0.0',
      );
    } else {
      // For direct commands, append the args
      serverArgs.push('--transport', 'http');
      serverArgs.push('--port', (8000 + Math.floor(Math.random() * 1000)).toString());
      serverArgs.push('--host', '0.0.0.0');
    }

    // Determine the full command path
    let fullCommand = command;
    if (platform() === 'win32' && !command.endsWith('.exe') && !isNpx) {
      fullCommand = `${command}.exe`;
    }

    // Resolve relative paths if needed
    let workingDir = cwd;
    if (workingDir && !path.isAbsolute(workingDir)) {
      workingDir = path.resolve(process.cwd(), workingDir);
    }

    // Log environment variables if any
    if (env) {
      console.log(chalk.gray(`MCP server "${name}" environment variables:`, env));
    }

    console.log(chalk.blue(`Starting MCP server "${name}" with command: ${fullCommand} ${serverArgs.join(' ')}`));

    // Keep any existing environment variables from config
    const serverEnv = {
      ...process.env,
      ...env,
      DEBUG: 'mcp:*', // Enable MCP debug logging
    };

    // Check if the command exists - only for non-npx commands
    if (!isNpx) {
      try {
        const checkPath = spawn('which', [fullCommand], { shell: true });
        checkPath.stdout.on('data', (data) => {
          console.log(chalk.gray(`Command ${fullCommand} found at: ${data.toString().trim()}`));
        });
        checkPath.stderr.on('data', (data) => {
          console.error(chalk.yellow(`Warning finding command ${fullCommand}: ${data.toString().trim()}`));
        });

        // Wait for the command check to complete
        await new Promise((resolve) => {
          checkPath.on('close', (code) => {
            if (code !== 0) {
              console.warn(chalk.yellow(`Command '${fullCommand}' may not be available (exit code ${code})`));
            }
            resolve(null);
          });
        });
      } catch (error) {
        console.warn(chalk.yellow(`Error checking command ${fullCommand}:`, error));
      }
    }

    // Extract the port from the arguments for later connection
    const portIndex = serverArgs.indexOf('--port');
    const serverPort = portIndex >= 0 ? parseInt(serverArgs[portIndex + 1], 10) : 0;
    if (!serverPort) {
      throw new Error(`Could not determine port for MCP server "${name}"`);
    }

    // Start the server process
    console.log(chalk.blue(`Spawning process: ${fullCommand} ${serverArgs.join(' ')}`));
    const serverProcess = spawn(fullCommand, serverArgs, {
      cwd: workingDir,
      stdio: 'pipe',
      shell: true,
      env: serverEnv,
    });

    // Server URL and client URL
    const serverUrl = `http://0.0.0.0:${serverPort}`;
    const clientUrl = `http://localhost:${serverPort}`;

    // Variable to track if we've seen the server startup message
    let serverStartupSeen = false;

    // Set up output listeners
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(chalk.gray(`[${name}] ${output}`));

      // Look for server startup messages
      if (!serverStartupSeen && (output.includes('running on') || output.includes('listening'))) {
        console.log(chalk.green(`MCP server "${name}" startup message detected`));
        serverStartupSeen = true;
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      // Change color depending on if this looks like an error or just info on stderr
      if (output.toLowerCase().includes('error') || output.toLowerCase().includes('failed')) {
        console.error(chalk.red(`[${name}:ERROR] ${output}`));
      } else {
        console.log(chalk.yellow(`[${name}:STDERR] ${output}`));
      }
    });

    // Handle process errors and exit
    serverProcess.on('error', (error) => {
      console.error(chalk.red(`Failed to start server '${name}' (${command}):`, error));
    });

    serverProcess.on('exit', (code, signal) => {
      if (code !== 0) {
        console.error(chalk.red(`MCP server '${name}' exited with code ${code} and signal ${signal}`));
      } else {
        console.log(chalk.blue(`MCP server '${name}' exited normally`));
      }
      // Unregister the server when it exits
      registry.unregisterServer(name);
    });

    // Wait a moment for the process to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if the process is still running
    if (serverProcess.killed) {
      throw new Error(`Server process for '${name}' exited immediately`);
    }

    // Register the server provisionally
    registry.registerServer(name, serverUrl, serverProcess);

    // Wait for the server to be ready before proceeding
    console.log(chalk.blue(`Waiting for MCP server "${name}" to be ready...`));

    // Give the server time to initialize then check its health
    const isReady = await waitForServerReady(clientUrl);

    if (!isReady) {
      // Server didn't respond in time
      console.error(chalk.red(`MCP server "${name}" failed to initialize properly`));
      // We don't throw here to allow other servers to continue
    } else {
      console.log(chalk.green(`MCP server "${name}" is ready and accepting connections`));
    }
  } catch (error: any) {
    console.error(chalk.red(`Error starting MCP server "${name}":`, error.message || String(error)));
    throw error; // Propagate the error to be caught by the Promise.allSettled
  }
}
