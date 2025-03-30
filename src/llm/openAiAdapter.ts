import fetch from 'node-fetch';
import { LlmAdapter, LlmConfig, LlmResponse } from './llmAdapter';

/**
 * Adapter for the OpenAI API
 */
export default class OpenAiAdapter implements LlmAdapter {
  private apiKey: string;

  private model: string;

  private baseUrl: string;

  private conversations: Map<string, Array<any>>;

  constructor(config: LlmConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.conversations = new Map();
  }

  /**
   * Calls the OpenAI API with tools
   */
  async callModelWithTools(
    prompt: string,
    tools: Array<any>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    // Convert MCP tools to OpenAI function format
    const functions = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties || {},
          required: tool.parameters.required || [],
        },
      },
    }));

    // Get or create conversation history
    const messages = this.getOrCreateConversation(conversationId);

    // Add user message to history
    messages.push({
      role: 'user',
      content: prompt,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
        throw new Error(`OpenAI API error: ${error}`);
      }

      const result = await response.json();
      const { message } = result.choices[0];

      // Add assistant message to history
      messages.push(message);

      // Convert OpenAI response to standardized format
      return OpenAiAdapter.convertOpenAiResponse(message);
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw error;
    }
  }

  /**
   * Calls the OpenAI API without tools
   */
  async callModel(
    prompt: string,
    conversationId?: string,
  ): Promise<LlmResponse> {
    return this.callModelWithTools(prompt, [], conversationId);
  }

  /**
   * Gets or creates a conversation history
   */
  private getOrCreateConversation(conversationId?: string): Array<any> {
    if (!conversationId) {
      return [{
        role: 'system',
        content: 'You are an AI assistant helping with coding tasks.',
      }];
    }

    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, [{
        role: 'system',
        content: 'You are an AI assistant helping with coding tasks.',
      }]);
    }

    return this.conversations.get(conversationId)!;
  }

  /**
   * Converts OpenAI response format to standardized format
   */
  private static convertOpenAiResponse(message: any): LlmResponse {
    const response: LlmResponse = {
      content: message.content || '',
    };

    if (message.tool_calls && message.tool_calls.length > 0) {
      response.toolCalls = message.tool_calls.map((toolCall: any) => ({
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments),
      }));
    }

    return response;
  }
}
