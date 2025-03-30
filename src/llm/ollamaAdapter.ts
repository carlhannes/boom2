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

  private useOpenAICompatibility: boolean;

  constructor(config: LlmConfig) {
    // For testing environments, we want to use localhost
    // In production Docker environments, we want to use host.docker.internal
    if (process.env.NODE_ENV === 'test') {
      this.baseUrl = config.baseUrl || 'http://localhost:11434';
    } else {
      this.baseUrl = config.baseUrl || 'http://host.docker.internal:11434';
    }
    this.model = config.model || 'llama2';
    this.useOpenAICompatibility = config.useOpenAICompatibility || false;
  }

  /**
   * Calls the Ollama API with tools
   * @param prompt The user's input prompt
   * @param tools Array of available tools
   * @param conversationId Conversation ID (only used in OpenAI compatibility mode)
   */
  async callModelWithTools(
    prompt: string,
    tools: Array<any>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    // If OpenAI compatibility is enabled, use the OpenAI-compatible endpoint
    if (this.useOpenAICompatibility) {
      return this.callWithOpenAICompatibility(prompt, tools, conversationId);
    }

    // Otherwise, use the standard Ollama approach
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
      return this.parseToolCallsFromResponse(text);
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      throw error;
    }
  }

  /**
   * Calls Ollama using the OpenAI-compatible endpoint
   * This is only available for certain models that support the OpenAI API format
   */
  private async callWithOpenAICompatibility(
    prompt: string,
    tools: Array<any>,
    // We need this parameter for the interface, even if not used for all configurations
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conversationId?: string,
  ): Promise<LlmResponse> {
    // Format tools for OpenAI compatibility
    const functions = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // Set up messages
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful AI assistant. Use tools when appropriate.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    try {
      // Use the OpenAI-compatible endpoint
      const endpoint = `${this.baseUrl}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: functions.length > 0 ? functions : undefined,
          tool_choice: functions.length > 0 ? 'auto' : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error (OpenAI compatibility): ${error}`);
      }

      const result = await response.json();
      console.log('Ollama response (OpenAI compatibility):', result);

      // Parse the response in OpenAI format
      const { message } = result.choices[0];
      const content = message.content || '';

      // Check for tool calls
      let toolCalls;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((toolCall: any) => ({
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments),
        }));
      }

      return {
        content,
        toolCalls,
      };
    } catch (error) {
      console.error('Error calling Ollama API (OpenAI compatibility):', error);
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
   * This method doesn't use instance properties, but we keep it as a member method
   * for consistency with the rest of the class
   */
  // Using this class method to maintain consistent coding style
  // eslint-disable-next-line class-methods-use-this
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
          const jsonString = match[1];
          const toolCallData = JSON.parse(jsonString);

          if (toolCallData.tool) {
            // Found a valid tool call
            toolCalls.push({
              name: toolCallData.tool,
              arguments: toolCallData.parameters || {},
            });

            // Remove the tool call from the content
            modifiedContent = modifiedContent.replace(match[0], '');
          }
        } catch (error) {
          // Skip invalid JSON
          console.warn('Failed to parse tool call JSON:', error);
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
   * @param conversationId Conversation ID (only used in OpenAI compatibility mode)
   */
  async callModelWithToolResults(
    originalPrompt: string,
    initialResponse: string,
    toolResults: Array<{ toolName: string; toolCall: any; result: any }>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    // If OpenAI compatibility is enabled, use the OpenAI-compatible endpoint
    if (this.useOpenAICompatibility) {
      return this.callWithToolResultsOpenAICompatibility(
        originalPrompt,
        initialResponse,
        toolResults,
        conversationId,
      );
    }

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

  /**
   * Calls Ollama with tool results using the OpenAI-compatible endpoint
   */
  private async callWithToolResultsOpenAICompatibility(
    originalPrompt: string,
    initialResponse: string,
    toolResults: Array<{ toolName: string; toolCall: any; result: any }>,
    // We need this parameter for the interface, even if not used for all configurations
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conversationId?: string,
  ): Promise<LlmResponse> {
    // Set up messages in OpenAI format
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful AI assistant. Use tools when appropriate.',
      },
      {
        role: 'user',
        content: originalPrompt,
      },
      {
        role: 'assistant',
        content: initialResponse,
        tool_calls: toolResults.map((result, index) => ({
          id: `call_${index}`,
          type: 'function',
          function: {
            name: result.toolName,
            arguments: JSON.stringify(result.toolCall.arguments),
          },
        })),
      },
    ];

    // Add tool results as tool response messages
    for (const [index, result] of toolResults.entries()) {
      messages.push({
        role: 'tool',
        // @ts-ignore - Ollama API with OpenAI compatibility accepts tool_call_id, but TypeScript definition doesn't include it
        tool_call_id: `call_${index}`,
        content: JSON.stringify(result.result),
      });
    }

    try {
      // Use the OpenAI-compatible endpoint
      const endpoint = `${this.baseUrl}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          // Don't include tools here as we're just getting the final response
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error (OpenAI compatibility): ${error}`);
      }

      const result = await response.json();
      console.log('Ollama response with tool results (OpenAI compatibility):', result);

      // Parse the response in OpenAI format
      const { message } = result.choices[0];
      const content = message.content || '';

      // Check for additional tool calls
      let toolCalls;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((toolCall: any) => ({
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments),
        }));
      }

      return {
        content,
        toolCalls,
      };
    } catch (error) {
      console.error('Error calling Ollama API with tool results (OpenAI compatibility):', error);
      throw error;
    }
  }
}

// Register this adapter with the factory
registerLlmAdapter('ollama', (config) => new OllamaAdapter(config));

export default OllamaAdapter;
