import fetch from 'node-fetch';
import {
  LlmAdapter,
  LlmConfig,
  LlmResponse,
  registerLlmAdapter,
} from './llmAdapter';

/**
 * Adapter for the OpenAI API
 */
class OpenAiAdapter implements LlmAdapter {
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
    // Format the tools for OpenAI's format
    const functions = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // Set up conversation messages
    let messages = [
      {
        role: 'system',
        content: 'You are a helpful AI assistant. Use tools when appropriate.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    // Add previous messages if we have a conversation ID
    if (conversationId && this.conversations.has(conversationId)) {
      const previousMessages = this.conversations.get(conversationId) || [];
      messages = [...previousMessages, ...messages];
    }

    try {
      // Call the OpenAI API
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
      console.log('OpenAI response:', result);

      // Process the response
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

      // Save this message to the conversation if we have a conversation ID
      if (conversationId) {
        const conversationMessages = this.conversations.get(conversationId) || [];
        conversationMessages.push(message);
        this.conversations.set(conversationId, conversationMessages);
      }

      return {
        content,
        toolCalls,
      };
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
}

// Register this adapter with the factory
registerLlmAdapter('openai', (config) => new OpenAiAdapter(config));

export default OpenAiAdapter;
