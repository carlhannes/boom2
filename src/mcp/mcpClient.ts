import { ChildProcess } from 'child_process';
import axios from 'axios';
import chalk from 'chalk';

/**
 * Client for interacting with MCP (Model Context Protocol) servers
 */
export default class McpClient {
  private baseUrl?: string;

  private process?: ChildProcess;

  private transport: 'http' | 'stdio';

  private availableTools: any[] = [];

  private toolsLoaded = false;

  private pendingRequests: Map<string, { resolve: Function, reject: Function }> = new Map();

  private messageId = 1;

  /**
   * Creates a new MCP client
   *
   * @param serverOrUrl The base URL of the MCP server or a ChildProcess for stdio mode
   */
  constructor(serverOrUrl: string | ChildProcess) {
    if (typeof serverOrUrl === 'string') {
      this.baseUrl = serverOrUrl.endsWith('/') ? serverOrUrl.slice(0, -1) : serverOrUrl;
      this.transport = 'http';
    } else {
      this.process = serverOrUrl;
      this.transport = 'stdio';
      this.setupStdioHandlers();
    }
  }

  /**
   * Sets up handlers for stdio-based communication
   */
  private setupStdioHandlers(): void {
    if (!this.process) {
      return;
    }

    // Set up message handling from server to client
    this.process.stdout?.on('data', (data: Buffer) => {
      const messageText = data.toString().trim();
      if (!messageText) return;

      console.log(chalk.cyan(`[MCP Client] Received message: ${messageText}`));

      try {
        // For a proper implementation, we'd need to handle partial messages
        // and JSON parsing errors more robustly
        const message = JSON.parse(messageText);

        // Handle JSON-RPC response messages
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;

          if (message.error) {
            console.error(chalk.red(`[MCP Client] Error response received: ${JSON.stringify(message.error)}`));
            reject(new Error(message.error.message || 'Unknown error'));
          } else {
            console.log(chalk.green(`[MCP Client] Success response received: ${JSON.stringify(message.result)}`));
            resolve(message.result);
          }

          this.pendingRequests.delete(message.id);
        }
      } catch (error) {
        console.error(chalk.red('Error parsing message from MCP server:'), error);
        console.error(chalk.gray('Raw message:'), messageText);
      }
    });

    // Log any error output
    this.process.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      console.error(chalk.yellow(`[MCP Server STDERR] ${output}`));
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      console.log(chalk.gray(`MCP server process exited with code ${code} and signal ${signal}`));

      // Reject any pending requests
      for (const [id, { reject }] of this.pendingRequests.entries()) {
        reject(new Error(`Server process exited with code ${code}`));
        this.pendingRequests.delete(id);
      }
    });
  }

  /**
   * Sends a request to the MCP server via stdio
   * @param method The method name
   * @param params The parameters for the request
   */
  private async sendStdioRequest(method: string, params: any): Promise<any> {
    if (!this.process || !this.process.stdin?.writable) {
      throw new Error('MCP server process is not available or not writable');
    }

    const id = `${Date.now()}-${this.messageId}`;
    this.messageId += 1;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const requestStr = `${JSON.stringify(request)}\n`;

      // Log the outgoing request for debugging
      console.log(chalk.blue(`[MCP Client] Sending ${method} request: ${requestStr.trim()}`));

      // Since we already checked this.process and this.process.stdin.writable above,
      // we can use the non-null assertion operator here safely
      this.process!.stdin!.write(requestStr);

      // Set a timeout to clean up hanging requests
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Discovers the available methods on the MCP server
   * This uses a common JSON-RPC introspection technique
   */
  private async discoverServerMethods(): Promise<void> {
    try {
      // Try standard JSON-RPC 2.0 introspection methods
      console.log(chalk.magenta('[MCP Client] Attempting to discover server methods via introspection'));

      // First try: rpc.discover (used by some JSON-RPC servers)
      try {
        console.log(chalk.magenta('[MCP Client] Trying rpc.discover method'));
        const result = await this.sendStdioRequest('rpc.discover', {});
        console.log(chalk.green(`[MCP Client] rpc.discover succeeded: ${JSON.stringify(result)}`));
        return;
      } catch (error: any) {
        console.error(chalk.yellow(`[MCP Client] rpc.discover failed: ${error.message}`));
      }

      // Second try: system.listMethods (used by some JSON-RPC servers)
      try {
        console.log(chalk.magenta('[MCP Client] Trying system.listMethods method'));
        const result = await this.sendStdioRequest('system.listMethods', {});
        console.log(chalk.green(`[MCP Client] system.listMethods succeeded: ${JSON.stringify(result)}`));
        return;
      } catch (error: any) {
        console.error(chalk.yellow(`[MCP Client] system.listMethods failed: ${error.message}`));
      }

      // Third try: ListMethods (non-standard but sometimes used)
      try {
        console.log(chalk.magenta('[MCP Client] Trying rpc.ListMethods method'));
        const result = await this.sendStdioRequest('rpc.ListMethods', {});
        console.log(chalk.green(`[MCP Client] rpc.ListMethods succeeded: ${JSON.stringify(result)}`));
        return;
      } catch (error: any) {
        console.error(chalk.yellow(`[MCP Client] rpc.ListMethods failed: ${error.message}`));
      }

      // Fourth try: Try a common method that often exists
      try {
        console.log(chalk.magenta('[MCP Client] Trying a simplified get_tools method'));
        const result = await this.sendStdioRequest('get_tools', {});
        console.log(chalk.green(`[MCP Client] get_tools succeeded: ${JSON.stringify(result)}`));
        return;
      } catch (error: any) {
        console.error(chalk.yellow(`[MCP Client] get_tools failed: ${error.message}`));
      }

      console.log(chalk.red('[MCP Client] Could not discover server methods via introspection'));
    } catch (error: any) {
      console.error(chalk.red(`[MCP Client] Method discovery failed: ${error.message}`));
    }
  }

  /**
   * Tests different versions of the MCP method prefixes
   * to handle compatibility with different server implementations
   *
   * @param retries Number of retries
   * @param attempt Current attempt number
   */
  private async tryDifferentMethods(retries: number, attempt: number): Promise<{ tools: any[] }> {
    // First try to discover the methods through introspection
    await this.discoverServerMethods();

    // Based on the official MCP SDK specification, the correct method is tools/list
    // The other variations are for backward compatibility
    const methodVariations = [
      'tools/list', // This is the official MCP method according to SDK
      'tools.list',
      'mcp.listTools',
      'listTools',
      'get_tools',
      'getTools',
      'tools.get',
      'rpc.tools',
      'list_mcp_tools',
    ];

    let lastError = null;

    // Try each method variation before giving up
    for (const method of methodVariations) {
      try {
        console.log(chalk.magenta(`[MCP Client] Trying method: ${method} (attempt ${attempt + 1}/${retries + 1})`));
        const result = await this.sendStdioRequest(method, {});
        console.log(chalk.green(`[MCP Client] Method ${method} succeeded!`));
        return result;
      } catch (error: any) {
        lastError = error;
        console.error(chalk.yellow(`[MCP Client] Method ${method} failed: ${error.message}`));
        // Continue to next method variation
      }
    }

    // If all variations failed, throw the last error
    throw lastError;
  }

  /**
   * Loads available tools from the MCP server
   * @param retries Number of retries to attempt (default: 3)
   * @param delay Delay between retries in milliseconds (default: 1000)
   */
  async loadTools(retries = 3, delay = 1000): Promise<void> {
    if (this.toolsLoaded) {
      return;
    }

    let lastError = null;

    // Try multiple times with increasing delay
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        if (this.transport === 'http') {
          console.log(`Attempting to connect to MCP server at ${this.baseUrl} (attempt ${attempt + 1}/${retries + 1})`);
          const response = await axios.get(`${this.baseUrl}/tools`);
          this.availableTools = response.data.tools || [];
        } else {
          console.log(`Attempting to list tools from stdio MCP server (attempt ${attempt + 1}/${retries + 1})`);

          // Try different method variations to handle compatibility issues
          const result = await this.tryDifferentMethods(retries, attempt);
          this.availableTools = result.tools || [];
        }

        this.toolsLoaded = true;
        console.log(`Successfully loaded ${this.availableTools.length} tools from MCP server`);
        console.log(chalk.green(`[MCP Client] Available tools: ${JSON.stringify(this.availableTools.map((t) => t.name))}`));
        return;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || String(error);
        console.error(`Failed to load tools from MCP server (attempt ${attempt + 1}/${retries + 1}): ${errorMessage}`);

        // If this is not the last attempt, wait before retrying
        if (attempt < retries) {
          const waitTime = delay * (attempt + 1); // Exponential backoff
          console.log(`Waiting ${waitTime}ms before retry...`);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => { setTimeout(resolve, waitTime); });
        }
      }
    }

    // If we get here, we've exhausted all retries
    this.toolsLoaded = false; // Make sure this is marked as not loaded
    throw new Error(`Failed to load tools from MCP server after ${retries + 1} attempts: ${lastError}`);
  }

  /**
   * Gets all available tools from the MCP server
   */
  async getTools(): Promise<any[]> {
    if (!this.toolsLoaded) {
      await this.loadTools();
    }
    return this.availableTools;
  }

  /**
   * Invokes a tool on the MCP server
   *
   * @param tool The name of the tool to invoke
   * @param args The arguments to pass to the tool
   */
  async invokeTool(tool: string, args: Record<string, any>): Promise<any> {
    return this.callTool(tool, args);
  }

  /**
   * Tries different method variations for calling a tool
   * to handle compatibility with different server implementations
   *
   * @param tool The name of the tool to call
   * @param args The arguments to pass to the tool
   */
  private async tryDifferentToolCallMethods(tool: string, args: Record<string, any>): Promise<any> {
    const methodVariations = [
      {
        method: 'tools/call', // This is the official MCP method according to SDK
        paramsFormat: { name: tool, arguments: args },
      },
      {
        method: 'mcp.callTool',
        paramsFormat: { name: tool, arguments: args },
      },
      {
        method: 'callTool',
        paramsFormat: { name: tool, arguments: args },
      },
      {
        method: 'tools.call',
        paramsFormat: { name: tool, arguments: args },
      },
      {
        method: 'invoke',
        paramsFormat: { tool, arguments: args },
      },
      {
        method: 'tool.invoke',
        paramsFormat: { name: tool, arguments: args },
      },
      {
        method: tool,
        paramsFormat: args,
      },
    ];

    let lastError = null;

    // Try each method variation before giving up
    for (const { method, paramsFormat } of methodVariations) {
      try {
        console.log(chalk.magenta(`[MCP Client] Trying tool call method: ${method} with params: ${JSON.stringify(paramsFormat)}`));
        const result = await this.sendStdioRequest(method, paramsFormat);
        console.log(chalk.green(`[MCP Client] Tool call method ${method} succeeded!`));
        return result;
      } catch (error: any) {
        lastError = error;
        console.error(chalk.yellow(`[MCP Client] Tool call method ${method} failed: ${error.message}`));
        // Continue to next method variation
      }
    }

    // If all variations failed, throw the last error
    throw lastError;
  }

  /**
   * Calls a tool on the MCP server
   *
   * @param tool The name of the tool to call
   * @param args The arguments to pass to the tool
   */
  async callTool(tool: string, args: Record<string, any>): Promise<any> {
    if (!this.toolsLoaded) {
      await this.loadTools();
    }

    // Verify that the tool exists
    const toolExists = this.availableTools.some((t) => t.name === tool);
    if (!toolExists && this.availableTools.length > 0) {
      throw new Error(`Tool '${tool}' is not available on the MCP server`);
    }

    try {
      if (this.transport === 'http') {
        const response = await axios.post(`${this.baseUrl}/invoke`, {
          tool,
          arguments: args,
        });
        return response.data;
      }

      // Try different method variations to handle compatibility issues
      return await this.tryDifferentToolCallMethods(tool, args);
    } catch (error) {
      throw new Error(`Failed to invoke tool '${tool}': ${error}`);
    }
  }
}
