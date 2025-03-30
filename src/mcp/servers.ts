import { spawn } from 'child_process';
import { platform } from 'os';
import path from 'path';
import chalk from 'chalk';
import McpRegistry, { McpServerConfig } from './mcpRegistry';
import McpClient from './mcpClient';

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

    // Create a copy of the original args - DO NOT add transport args as we're using stdio
    const serverArgs = [...args];

    const isNpx = command === 'npx';

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
      console.log(chalk.gray(`MCP server "${name}" environment variables: ${JSON.stringify(env)}`));
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

    // Start the server process with stdio for MCP
    console.log(chalk.blue(`Spawning process: ${fullCommand} ${serverArgs.join(' ')}`));
    const serverProcess = spawn(fullCommand, serverArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'], // Use pipes for stdin, stdout, stderr
      shell: true,
      env: serverEnv,
    });

    // Variable to track if we've seen the server startup message
    let serverStartupSeen = false;

    // Set up output listeners
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      // console.log(chalk.gray(`[${name}:STDOUT] ${output}`));

      // Look for server startup messages
      if (!serverStartupSeen && (output.includes('running on') || output.includes('listening'))) {
        console.log(chalk.green(`MCP server "${name}" startup message detected`));
        serverStartupSeen = true;
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      // Change color depending on if this looks like an error or just info on stderr
      if (output.toLowerCase().includes('error') && !output.includes('running on stdio')) {
        console.error(chalk.red(`[${name}:ERROR] ${output}`));
      } else {
        console.log(chalk.yellow(`[${name}:STDERR] ${output}`));

        // Check for stdio startup message
        if (output.includes('running on stdio')) {
          console.log(chalk.green(`MCP server "${name}" running on stdio transport`));
          serverStartupSeen = true;
        }
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
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    // Check if the process is still running
    if (serverProcess.killed) {
      throw new Error(`Server process for '${name}' exited immediately`);
    }

    // Create an MCP client connected to the server via stdio
    // This now uses the official MCP SDK internally
    const client = new McpClient(serverProcess);

    // Register the server with the registry
    registry.registerStdioServer(name, client, serverProcess);

    // Wait a bit to let things initialize
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });

    // Try to load tools to verify the connection is working
    try {
      await client.loadTools(2, 500);
      console.log(chalk.green(`MCP server "${name}" is now available via stdio transport with tools loaded`));
    } catch (error) {
      console.warn(chalk.yellow(`MCP server "${name}" started but couldn't load tools initially: ${error}`));
      console.log(chalk.gray('This is not critical - tools will be loaded when needed'));
    }
  } catch (error: any) {
    console.error(chalk.red(`Error starting MCP server "${name}":`, error.message || String(error)));
    throw error; // Propagate the error to be caught by the Promise.allSettled
  }
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
