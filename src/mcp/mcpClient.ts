import axios from 'axios';

/**
 * Client for interacting with MCP (Model Context Protocol) servers
 */
export default class McpClient {
  private baseUrl: string;

  private availableTools: any[] = [];

  private toolsLoaded = false;

  /**
   * Creates a new MCP client
   *
   * @param baseUrl The base URL of the MCP server
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
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
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        console.log(`Attempting to connect to MCP server at ${this.baseUrl} (attempt ${attempt + 1}/${retries + 1})`);
        const response = await axios.get(`${this.baseUrl}/tools`);
        this.availableTools = response.data.tools || [];
        this.toolsLoaded = true;
        console.log(`Successfully loaded ${this.availableTools.length} tools from MCP server at ${this.baseUrl}`);
        return;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || String(error);
        console.error(`Failed to connect to MCP server at ${this.baseUrl} (attempt ${attempt + 1}/${retries + 1}): ${errorMessage}`);

        // If this is not the last attempt, wait before retrying
        if (attempt < retries) {
          const waitTime = delay * (attempt + 1); // Exponential backoff
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

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
    if (!this.toolsLoaded) {
      await this.loadTools();
    }
    // Verify that the tool exists
    const toolExists = this.availableTools.some((t) => t.name === tool);
    if (!toolExists) {
      throw new Error(`Tool '${tool}' is not available on the MCP server`);
    }
    try {
      const response = await axios.post(`${this.baseUrl}/invoke`, {
        tool,
        arguments: args,
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to invoke tool '${tool}': ${error}`);
    }
  }

  /**
   * Alias for invokeTool for backward compatibility
   *
   * @param tool The name of the tool to call
   * @param args The arguments to pass to the tool
   */
  async callTool(tool: string, args: Record<string, any>): Promise<any> {
    return this.invokeTool(tool, args);
  }
}
