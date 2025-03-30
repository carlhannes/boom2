import OpenAiAdapter from './openAiAdapter';
import AnthropicAdapter from './anthropicAdapter';
import OllamaAdapter from './ollamaAdapter';

/**
 * Configuration for LLM adapters
 */
export interface LlmConfig {
  /**
   * The LLM provider to use
   */
  provider: 'openai' | 'anthropic' | 'ollama';

  /**
   * API key for the LLM provider (not required for Ollama)
   */
  apiKey?: string;

  /**
   * Model to use for the LLM
   */
  model: string;

  /**
   * Base URL for the API (optional)
   */
  baseUrl?: string;
}

/**
 * Interface for LLM adapters
 */
export interface LlmAdapter {
  /**
   * Call the LLM with a prompt and available tools
   */
  callModelWithTools(
    prompt: string,
    tools: Array<any>,
    conversationId?: string
  ): Promise<{
    content: string;
    toolCalls?: Array<{
      name: string;
      arguments: Record<string, any>;
    }>;
  }>;
}

/**
 * Creates an LLM adapter based on the provided configuration
 */
export function createLlmAdapter(config: LlmConfig): LlmAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAiAdapter({
        apiKey: config.apiKey || '',
        model: config.model,
        baseUrl: config.baseUrl,
      });

    case 'anthropic':
      return new AnthropicAdapter({
        apiKey: config.apiKey || '',
        model: config.model,
        baseUrl: config.baseUrl,
      });

    case 'ollama':
      return new OllamaAdapter({
        model: config.model,
        baseUrl: config.baseUrl || 'http://localhost:11434',
      });

    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}
