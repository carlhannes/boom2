import { ChildProcess } from 'child_process';
import chalk from 'chalk';
import McpClient from './mcpClient';

/**
 * Server configuration for MCP servers
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Registry for managing MCP servers and clients
 */
export default class McpRegistry {
  private servers: Map<string, {
    serverUrl: string,
    process?: ChildProcess,
    builtIn: boolean,
    client: McpClient
  }>;

  private serverConfigs: Map<string, McpServerConfig>;

  constructor() {
    this.servers = new Map();
    this.serverConfigs = new Map();
  }

  /**
   * Registers an MCP server with the registry
   */
  registerServer(name: string, url: string, process?: ChildProcess): void {
    // For MCP servers running within the container, we need to replace 0.0.0.0 with localhost
    // when creating the client, since the client needs to connect to the local server
    const clientUrl = url.replace('0.0.0.0', 'localhost');

    this.servers.set(name, {
      serverUrl: url,
      process,
      builtIn: false,
      client: new McpClient(clientUrl),
    });
    console.log(chalk.gray(`Registered MCP server: ${name} at ${url} (client connects to ${clientUrl})`));
  }

  /**
   * Registers a server configuration
   */
  registerServerConfig(name: string, config: McpServerConfig): void {
    this.serverConfigs.set(name, config);
  }

  /**
   * Gets all server configurations
   */
  getServers(): Array<McpServerConfig & { name: string }> {
    const configs: Array<McpServerConfig & { name: string }> = [];

    for (const [name, config] of this.serverConfigs.entries()) {
      configs.push({
        name,
        ...config,
      });
    }

    return configs;
  }

  /**
   * Registers a built-in MCP server with the registry
   */
  registerBuiltInServer(name: string, url: string): void {
    // For built-in servers, we also need to replace 0.0.0.0 with localhost for client connections
    const clientUrl = url.replace('0.0.0.0', 'localhost');

    this.servers.set(name, {
      serverUrl: url,
      builtIn: true,
      client: new McpClient(clientUrl),
    });
    console.log(chalk.gray(`Registered built-in MCP server: ${name} at ${url} (client connects to ${clientUrl})`));
  }

  /**
   * Unregisters an MCP server from the registry
   */
  unregisterServer(name: string): void {
    if (this.servers.has(name)) {
      console.log(chalk.gray(`Unregistered MCP server: ${name}`));
      this.servers.delete(name);
    }

    if (this.serverConfigs.has(name)) {
      this.serverConfigs.delete(name);
    }
  }

  /**
   * Gets an MCP client by server name
   */
  getClient(name: string): McpClient | undefined {
    const server = this.servers.get(name);
    return server?.client;
  }

  /**
   * Gets all MCP clients in the registry
   */
  getAllClients(): Map<string, McpClient> {
    const clients = new Map<string, McpClient>();
    for (const [name, server] of this.servers.entries()) {
      clients.set(name, server.client);
    }
    return clients;
  }

  /**
   * Stops all MCP servers in the registry
   */
  async stopAllServers(): Promise<void> {
    console.log(chalk.blue('Stopping MCP servers...'));
    for (const [name, server] of this.servers.entries()) {
      if (server.process) {
        console.log(chalk.gray(`Stopping MCP server: ${name}`));
        server.process.kill();
      }
    }
    this.servers.clear();
    this.serverConfigs.clear();
    console.log(chalk.green('All MCP servers stopped'));
  }
}
