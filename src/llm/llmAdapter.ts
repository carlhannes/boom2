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
 * Standard response format from LLM adapters
 */
export interface LlmResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
  }>;
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
  ): Promise<LlmResponse>;

  /**
   * Call the LLM with just a prompt (no tools)
   */
  callModel?(
    prompt: string,
    conversationId?: string
  ): Promise<LlmResponse>;
}

/**
 * Factory function type for creating an LLM adapter
 * This helps avoid circular dependencies
 */
export type LlmAdapterFactory = (config: LlmConfig) => LlmAdapter;

// Map of provider names to their adapter factory functions
const adapterFactories: Record<string, LlmAdapterFactory> = {};

/**
 * Registers an LLM adapter factory for a specific provider
 */
export function registerLlmAdapter(
  provider: string,
  factory: LlmAdapterFactory,
): void {
  adapterFactories[provider] = factory;
}

/**
 * Creates an LLM adapter based on the provided configuration
 */
export function createLlmAdapter(config: LlmConfig): LlmAdapter {
  const factory = adapterFactories[config.provider];

  if (!factory) {
    throw new Error(`No adapter registered for provider: ${config.provider}`);
  }

  return factory(config);
}
