import { createLlmAdapter, LlmConfig } from '../llm/llmAdapter';
import McpRegistry from '../mcp/mcpRegistry';
import { createLogger, Logger } from '../utils/logger';

/**
 * Configuration for the agent controller
 */
interface AgentControllerConfig {
  llmConfig: LlmConfig;
  mcpRegistry: McpRegistry;
  verbose?: boolean;
  saveLogsToFile?: boolean;
}

/**
 * Main controller for the boom2 agent
 * Handles interactions between the LLM and MCP servers
 */
export default class AgentController {
  private llmConfig: LlmConfig;

  private mcpRegistry: McpRegistry;

  private logger: Logger;

  private conversationId: string | undefined;

  constructor(config: AgentControllerConfig) {
    this.llmConfig = config.llmConfig;
    this.mcpRegistry = config.mcpRegistry;

    // Initialize logger
    this.logger = createLogger({
      verbose: !!config.verbose,
      saveToFile: !!config.saveLogsToFile,
      logDir: '.boom2/logs',
    });
  }

  /**
   * Processes user input and generates a response
   */
  async processUserInput(input: string): Promise<void> {
    try {
      this.logger.verbose('User input:', input);

      // Get all available tools from registered MCP servers
      const mcpTools = await this.collectMcpTools();
      this.logger.verbose(`Found ${mcpTools.length} tools from MCP servers`);

      // Create an LLM adapter based on configuration
      const llm = createLlmAdapter(this.llmConfig);
      this.logger.verbose(
        `Using LLM provider: ${this.llmConfig.provider}, model: ${this.llmConfig.model}`,
      );

      // Query the LLM with available tools
      this.logger.info('Sending request to LLM...');
      const response = await llm.callModelWithTools(input, mcpTools, this.conversationId);
      this.logger.verbose('Received response from LLM');

      if (response.toolCalls && response.toolCalls.length > 0) {
        this.logger.verbose(`LLM requested ${response.toolCalls.length} tool call(s)`);

        // Handle tool calls and collect the results
        const toolResults = await this.handleToolCalls(response.toolCalls);

        // Send the tool results back to the LLM for further processing
        if (toolResults.length > 0) {
          this.logger.verbose('Sending tool results back to LLM...');

          // Call the LLM again with the tool results
          const finalResponse = await llm.callModelWithToolResults(
            input,
            response.content,
            toolResults,
            this.conversationId,
          );

          // Display the LLM's final response after processing tool results
          this.logger.success('\nAgent:', finalResponse.content);
          return;
        }
      }

      // If no tool calls or all tool calls failed, display the original response
      this.logger.success('\nAgent:', response.content);
    } catch (error) {
      this.logger.error('Error processing user input:', error);
    }
  }

  /**
   * Collects tools from all registered MCP servers
   */
  private async collectMcpTools(): Promise<Array<any>> {
    const allTools = [];
    const clients = this.mcpRegistry.getAllClients();

    for (const [serverName, client] of clients.entries()) {
      try {
        this.logger.verbose(`Getting tools from ${serverName}...`);
        const tools = await client.getTools();

        for (const tool of tools) {
          // Add server name to the tool to identify its source
          tool.serverId = serverName;
          allTools.push(tool);
        }

        this.logger.verbose(`Found ${tools.length} tools from ${serverName}`);
      } catch (error) {
        this.logger.warn(`Error getting tools from ${serverName}:`, error);
      }
    }

    return allTools;
  }

  /**
   * Handles tool calls from the LLM
   */
  private async handleToolCalls(
    toolCalls: Array<{ name: string; arguments: Record<string, any> }>,
  ): Promise<Array<{ toolName: string; toolCall: any; result: any }>> {
    const results = [];

    for (const call of toolCalls) {
      const result = await this.executeToolCall(call);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Executes a single tool call
   */
  private async executeToolCall(
    toolCall: { name: string; arguments: Record<string, any> },
  ): Promise<{ toolName: string; toolCall: any; result: any } | void> {
    try {
      // Find the correct server for this tool
      const toolName = toolCall.name;
      const clients = this.mcpRegistry.getAllClients();
      let foundServer = false;

      for (const [serverName, client] of clients.entries()) {
        try {
          // Try to get tools from this server to check if it has the one we need
          const serverTools = await client.getTools();
          const hasTool = serverTools.some((tool: any) => tool.name === toolName);

          if (hasTool) {
            // Call the tool
            this.logger.verbose(`Executing tool ${toolName} on ${serverName}`, toolCall.arguments);
            const result = await client.callTool(toolName, toolCall.arguments);

            // Log the result using our logger's tool method
            this.logger.tool(toolName, serverName, toolCall.arguments, result);

            foundServer = true;
            return { toolName, toolCall, result };
          }
        } catch (error) {
          this.logger.warn(`Error checking tools on ${serverName}:`, error);
        }
      }

      if (!foundServer) {
        this.logger.error(`No server found for tool ${toolName}`);
      }
    } catch (error) {
      this.logger.error('Error executing tool call:', error);
    }
  }

  /**
   * Closes the agent and performs cleanup
   */
  close(): void {
    this.logger.info('Closing boom2 agent');
    this.logger.close();
  }
}
