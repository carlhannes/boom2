import fetch from 'node-fetch';
import {
  LlmAdapter,
  LlmConfig,
  LlmResponse,
  registerLlmAdapter,
} from './llmAdapter';

/**
 * Adapter for the Ollama API
 */
class OllamaAdapter implements LlmAdapter {
  private baseUrl: string;

  private model: string;

  constructor(config: LlmConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.model = config.model || 'llama2';
  }

  /**
   * Calls the Ollama API with tools
   * @param prompt The user's input prompt
   * @param tools Array of available tools
   * @param _conversationId Conversation ID (not used in Ollama)
   */
  async callModelWithTools(
    prompt: string,
    tools: Array<any>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _conversationId?: string,
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
    }

    try {
      // Call the Ollama API
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: enhancedPrompt,
          stream: false,
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
      return OllamaAdapter.parseToolCallsFromResponse(text);
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _conversationId?: string,
  ): Promise<LlmResponse> {
    return this.callModelWithTools(prompt, [], _conversationId);
  }

  /**
   * Parses the LLM response text to extract tool calls
   * This is needed because Ollama doesn't natively support tool calls
   */
  private static parseToolCallsFromResponse(text: string): LlmResponse {
    const response: LlmResponse = {
      content: text,
    };

    // Look for JSON tool call in the response
    const jsonPattern = /```\s*\n(\{.*?\})\n```/s;
    const match = text.match(jsonPattern);
    if (match && match[1]) {
      try {
        const toolCallData = JSON.parse(match[1]);
        if (toolCallData.tool) {
          // Found a tool call
          response.toolCalls = [
            {
              name: toolCallData.tool,
              arguments: toolCallData.parameters || {},
            },
          ];
          // Remove the tool call from the content
          console.log('Found tool call in Ollama response:', toolCallData);
          response.content = text.replace(match[0], '').trim();
        }
      } catch (error) {
        // No valid JSON tool call found, just return the content
      }
    }

    return response;
  }
}

// Register this adapter with the factory
registerLlmAdapter('ollama', (config) => new OllamaAdapter(config));

export default OllamaAdapter;
