import fetch from 'node-fetch';
import { LlmAdapter, LlmConfig, LlmResponse } from './llmAdapter';

/**
 * Adapter for the Anthropic API
 */
export default class AnthropicAdapter implements LlmAdapter {
  private apiKey: string;

  private model: string;

  private baseUrl: string;

  constructor(config: LlmConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-2';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  }

  /**
   * Calls the Anthropic API with tools
   */
  async callModelWithTools(
    prompt: string,
    tools: Array<any>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    // Convert tools to Anthropic's tools format
    const anthropicTools = [];

    for (const tool of tools) {
      anthropicTools.push({
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties: tool.parameters.properties || {},
          required: tool.parameters.required || [],
        },
      });
    }

    try {
      // Call the Anthropic API
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${error}`);
      }

      const result = await response.json();
      console.log('Anthropic response:', result);

      // Extract the content and tool calls
      return this.processAnthropicResponse(result);
    } catch (error) {
      console.error('Error calling Anthropic API:', error);
      throw error;
    }
  }

  /**
   * Calls the Anthropic API without tools
   */
  async callModel(
    prompt: string,
    conversationId?: string,
  ): Promise<LlmResponse> {
    return this.callModelWithTools(prompt, [], conversationId);
  }

  /**
   * Processes the response from Anthropic API
   */
  private processAnthropicResponse(result: any): LlmResponse {
    const response: LlmResponse = {
      content: '',
    };

    // Extract content and tool calls from the response
    if (result.content && Array.isArray(result.content)) {
      for (const contentBlock of result.content) {
        if (contentBlock.type === 'text') {
          response.content += contentBlock.text;
        } else if (contentBlock.type === 'tool_use') {
          if (!response.toolCalls) {
            response.toolCalls = [];
          }

          response.toolCalls.push({
            name: contentBlock.name,
            arguments: contentBlock.input || {},
          });
        }
      }
    }

    console.log('Processed Anthropic response:', response);
    return response;
  }

  /**
   * Parses the LLM response to extract tool calls
   * This is a static utility method for formatting
   */
  private static parseToolCallsFromResponse(text: string): LlmResponse {
    const response: LlmResponse = {
      content: text,
    };

    // Similar to OllamaAdapter, look for JSON tool calls in markdown blocks
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
          response.content = text.replace(match[0], '').trim();
        }
      } catch (error) {
        // No valid JSON tool call found, just return the content
      }
    }

    return response;
  }
}
