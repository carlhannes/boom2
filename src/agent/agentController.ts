import chalk from 'chalk';
import { createLlmAdapter, LlmConfig } from '../llm/llmAdapter';
import McpRegistry from '../mcp/mcpRegistry';

/**
 * Configuration for the agent controller
 */
interface AgentControllerConfig {
  llmConfig: LlmConfig;
  mcpRegistry: McpRegistry;
  verbose?: boolean;
}

/**
 * Main controller for the boom2 agent
 * Handles interactions between the LLM and MCP servers
 */
export class AgentController {
  private llmConfig: LlmConfig;

  private mcpRegistry: McpRegistry;

  private verbose: boolean;

  private conversationId: string | undefined;

  constructor(config: AgentControllerConfig) {
    this.llmConfig = config.llmConfig;
    this.mcpRegistry = config.mcpRegistry;
    this.verbose = !!config.verbose;
  }

  /**
   * Processes user input and generates a response
   */
  async processUserInput(input: string): Promise<void> {
    try {
      if (this.verbose) {
        console.log(chalk.gray('User input:'), input);
      }

      // Get all available tools from registered MCP servers
      const mcpTools = await this.collectMcpTools();

      if (this.verbose) {
        console.log(chalk.gray(`Found ${mcpTools.length} tools from MCP servers`));
      }

      // Create an LLM adapter based on configuration
      const llm = createLlmAdapter(this.llmConfig);

      // Query the LLM with available tools
      const response = await llm.callModelWithTools(input, mcpTools, this.conversationId);

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Handle tool calls
        await this.handleToolCalls(response.toolCalls);
      }

      // Display the LLM's response
      console.log(chalk.green('\nAgent:'), response.content);
    } catch (error) {
      console.error(chalk.red('Error processing user input:'), error);
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
        const tools = await client.getTools();

        for (const tool of tools) {
          // Add server name to the tool to identify its source
          tool.serverId = serverName;
          allTools.push(tool);
        }
      } catch (error) {
        console.error(chalk.yellow(`Error getting tools from ${serverName}:`), error);
      }
    }

    return allTools;
  }

  /**
   * Handles tool calls from the LLM
   */
  private async handleToolCalls(toolCalls: Array<{ name: string; arguments: Record<string, any> }>): Promise<void> {
    for (const call of toolCalls) {
      await this.executeToolCall(call);
    }
  }

  /**
   * Executes a single tool call
   */
  private async executeToolCall(toolCall: { name: string; arguments: Record<string, any> }): Promise<void> {
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
            console.log(chalk.blue(`\nExecuting tool ${toolName} on ${serverName}...`));

            // Call the tool
            const result = await client.callTool(toolName, toolCall.arguments, this.verbose);

            // Format and display the result
            let resultStr = '';

            if (typeof result === 'object') {
              resultStr = JSON.stringify(result, null, 2);
            } else {
              resultStr = String(result);
            }

            console.log(chalk.cyan('Result:'), resultStr);
            foundServer = true;
            break;
          }
        } catch (error) {
          console.error(chalk.yellow(`Error checking tools on ${serverName}:`), error);
        }
      }

      if (!foundServer) {
        console.error(chalk.red(`No server found for tool ${toolName}`));
      }
    } catch (error) {
      console.error(chalk.red('Error executing tool call:'), error);
    }
  }
}
