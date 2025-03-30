import fetch from 'node-fetch';
import {
  LlmAdapter,
  LlmConfig,
  LlmResponse,
  registerLlmAdapter,
} from './llmAdapter';

/**
 * Adapter for the Ollama API using the native /api/generate endpoint
 */
class OllamaAdapter implements LlmAdapter {
  private baseUrl: string;
  private model: string;

  constructor(config: LlmConfig) {
    // For testing environments, we want to use localhost
    // In production Docker environments, we want to use host.docker.internal
    if (process.env.NODE_ENV === 'test') {
      this.baseUrl = config.baseUrl || 'http://localhost:11434';
    } else {
      this.baseUrl = config.baseUrl || 'http://host.docker.internal:11434';
    }
    this.model = config.model || 'llama2';
  }

  /**
   * Calls the Ollama API with tools using native /api/generate endpoint
   * @param prompt The user's input prompt
   * @param tools Array of available tools
   * @param conversationId Conversation ID (not used in Ollama native API)
   */
  async callModelWithTools(
    prompt: string,
    tools: Array<any>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    // Ollama doesn't natively support tool calls, so we need to format the prompt
    // to include the tools in a way that the model can understand
    let enhancedPrompt = prompt;
    if (tools.length > 0) {
      // Format tools as part of the prompt
      enhancedPrompt += '\n\nYou have access to the following tools:\n';
      for (const tool of tools) {
        enhancedPrompt += `\nTool: ${tool.name}\n`;
        enhancedPrompt += `Description: ${tool.description}\n`;
        // Format parameters
        if (tool.parameters && tool.parameters.properties) {
          enhancedPrompt += 'Parameters:\n';
          for (const [paramName, paramDetails] of Object.entries<any>(tool.parameters.properties)) {
            enhancedPrompt += `  - ${paramName}: ${paramDetails.description || 'No description'}\n`;
          }
        }
      }
      enhancedPrompt += '\nTo use a tool, respond in the following format:\n';
      enhancedPrompt += '```\n{{"tool": "tool_name", "parameters": {{"param1": "value1", "param2": "value2"}}}}\n```\n';
      enhancedPrompt += 'If you don\'t need to use a tool, just respond normally.';
      enhancedPrompt += '\nYou can use multiple tools by including multiple code blocks in this format.';
    }

    try {
      // Call the Ollama API with native /api/generate endpoint
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: enhancedPrompt,
          stream: false,
          options: {
            num_ctx: 4096, // Set context size to 4096 for larger context window
          }
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }

      const result = await response.json();
      console.log('Ollama response:', result);

      // Extract the generated text
      const text = result.response;

      // Parse the response to check for tool calls
      return this.parseToolCallsFromResponse(text);
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      throw error;
    }
  }

  /**
   * Calls the Ollama API without tools
   */
  async callModel(
    prompt: string,
    conversationId?: string,
  ): Promise<LlmResponse> {
    return this.callModelWithTools(prompt, [], conversationId);
  }

  /**
   * Parses the LLM response text to extract tool calls
   * This is needed because Ollama doesn't natively support tool calls in its standard API
   */
  private parseToolCallsFromResponse(text: string): LlmResponse {
    const response: LlmResponse = {
      content: text,
    };

    // Look for all JSON tool calls in the response using a global regex
    const jsonPattern = /```\s*\n(\{.*?\})\n```/gs;
    const matches = [...text.matchAll(jsonPattern)];

    if (matches.length > 0) {
      const toolCalls = [];
      let modifiedContent = text;

      for (const match of matches) {
        try {
          let jsonString = match[1];
          
          // Log the original string for debugging
          console.log('Original JSON string:', jsonString);
          
          // Fix for double braces with embedded quotes issue
          // First, handle the outer double braces
          if (jsonString.startsWith('{{') && jsonString.endsWith('}}')) {
            jsonString = jsonString.slice(1, -1);
          }
          
          // Then fix embedded double braces with quotes like {{"param1":"value"}}
          jsonString = jsonString.replace(/{{\s*"([^"]*)":/g, '{"$1":');
          jsonString = jsonString.replace(/:\s*{{/g, ':{');
          jsonString = jsonString.replace(/}},/g, '},');
          jsonString = jsonString.replace(/}}(\s*})/g, '}$1');
          
          // Handle any remaining double braces
          jsonString = jsonString.replace(/{{/g, '{');
          jsonString = jsonString.replace(/}}/g, '}');
          
          console.log('Attempting to parse JSON:', jsonString);
          const toolCallData = JSON.parse(jsonString);

          // Handle different tool call formats:
          // 1. Standard format: {"tool": "tool_name", "parameters": {...}}
          // 2. Map format: {"tool_name_1": {...}, "tool_name_2": {...}}
          
          if (toolCallData.tool) {
            // Standard format
            toolCalls.push({
              name: toolCallData.tool,
              arguments: toolCallData.parameters || {},
            });
          } else {
            // Try the map format where tool names are keys
            const toolNames = Object.keys(toolCallData);
            for (const toolName of toolNames) {
              if (typeof toolCallData[toolName] === 'object') {
                toolCalls.push({
                  name: toolName,
                  arguments: toolCallData[toolName] || {},
                });
              }
            }
          }

          // Remove the tool call from the content
          modifiedContent = modifiedContent.replace(match[0], '');
        } catch (error) {
          // Log more detailed error information for debugging
          console.warn('Failed to parse tool call JSON:', error);
          if (match && match[1]) {
            console.warn('Original JSON string:', match[1]);
          }
        }
      }

      if (toolCalls.length > 0) {
        response.toolCalls = toolCalls;
        response.content = modifiedContent.trim();
        console.log(`Found ${toolCalls.length} tool call(s) in Ollama response:`, toolCalls);
      }
    }

    return response;
  }

  /**
   * Calls the Ollama API with tool results to get a final response
   * @param originalPrompt The original user prompt
   * @param initialResponse The initial response from the LLM
   * @param toolResults Results from tool executions
   * @param conversationId Conversation ID (not used in Ollama native API)
   */
  async callModelWithToolResults(
    originalPrompt: string,
    initialResponse: string,
    toolResults: Array<{ toolName: string; toolCall: any; result: any }>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    // Format a new prompt that includes the original prompt, initial response, and tool results
    let enhancedPrompt = `Original user request: ${originalPrompt}\n\n`;
    enhancedPrompt += `You started to respond with: ${initialResponse}\n\n`;
    enhancedPrompt += "I've executed the tools you requested. Here are the results:\n\n";

    // Add each tool result
    for (const { toolName, toolCall, result } of toolResults) {
      enhancedPrompt += `Tool: ${toolName}\n`;
      enhancedPrompt += `Arguments: ${JSON.stringify(toolCall.arguments)}\n`;
      enhancedPrompt += `Result: ${JSON.stringify(result)}\n\n`;
    }

    enhancedPrompt += 'Please continue your response based on these tool results. If you need to use additional tools, you can request them in the same format as before.';

    try {
      // Call the Ollama API with the enhanced prompt
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: enhancedPrompt,
          stream: false,
          options: {
            num_ctx: 4096, // Set context size to 4096 for larger context window
          }
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }

      const result = await response.json();
      console.log('Ollama response with tool results:', result);

      // Extract the generated text
      const text = result.response;

      // Parse the response to check for additional tool calls
      return this.parseToolCallsFromResponse(text);
    } catch (error) {
      console.error('Error calling Ollama API with tool results:', error);
      throw error;
    }
  }
}

// Register this adapter with the factory
registerLlmAdapter('ollama', (config) => new OllamaAdapter(config));

export default OllamaAdapter;
