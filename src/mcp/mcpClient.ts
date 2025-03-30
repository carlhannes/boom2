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
   */
  async loadTools(): Promise<void> {
    if (this.toolsLoaded) {
      return;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/tools`);
      this.availableTools = response.data.tools || [];
      this.toolsLoaded = true;
    } catch (error) {
      throw new Error(`Failed to load tools from MCP server: ${error}`);
    }
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
}
