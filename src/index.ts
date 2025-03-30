/**
 * Main entry point for the boom2 application
 * This file simply re-exports the main components for easier imports
 */

// Import LLM adapters first to ensure they register themselves
import './llm/openAiAdapter';
import './llm/ollamaAdapter';
import './llm/anthropicAdapter';

// Re-export CLI components
// CLI module doesn't have named exports but it contains the main execution code
import './cli/cli';

export * from './cli/config';

// Re-export MCP components
export { default as McpClient } from './mcp/mcpClient';
export { default as McpRegistry } from './mcp/mcpRegistry';
export { default as startMcpServers } from './mcp/servers';
export { default as ShellExecServer } from './mcp/shellExec';

// Re-export LLM components
export * from './llm/llmAdapter';
export { default as OpenAiAdapter } from './llm/openAiAdapter';
export { default as OllamaAdapter } from './llm/ollamaAdapter';
export { default as AnthropicAdapter } from './llm/anthropicAdapter';

// Re-export Agent components
export { default as AgentController } from './agent/agentController';
