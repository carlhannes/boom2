import fetch, { Response as NodeFetchResponse } from 'node-fetch';
import { createLlmAdapter, LlmConfig, registerLlmAdapter } from '../../llm/llmAdapter';
import McpRegistry from '../../mcp/mcpRegistry';
import McpClient from '../../mcp/mcpClient';
import OllamaAdapter from '../../llm/ollamaAdapter';
import OpenAiAdapter from '../../llm/openAiAdapter';

// Import node-fetch once at the top

// Create manual mocks rather than jest.mock to have more control
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockMcpRegistry = () => ({
  getAllClients: jest.fn(),
  getClient: jest.fn(),
} as unknown as McpRegistry);

const mockMcpClient = (toolsResponse: any[]) => ({
  getTools: jest.fn().mockResolvedValue(toolsResponse),
  invokeTool: jest.fn(),
  callTool: jest.fn(),
  loadTools: jest.fn().mockResolvedValue(undefined),
} as unknown as McpClient);

// Mock fetch for testing adapters directly
jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation((url) => {
    // Check if the URL includes OpenAI endpoints
    if (url.toString().includes('/v1/chat/completions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [
            {
              message: {
                content: 'OpenAI format response',
                role: 'assistant',
              },
            },
          ],
        }),
        text: () => Promise.resolve(''),
      });
    }
    
    // Default response for Ollama
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ response: 'Ollama format response' }),
      text: () => Promise.resolve(''),
    });
  });
});

// Sample MCP tool definitions that we'd expect from MCP servers
const sampleMcpTools = [
  {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file',
        },
        encoding: {
          type: 'string',
          description: 'The encoding to use',
          enum: ['utf8', 'binary'],
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
      },
      required: ['path', 'content'],
    },
  },
];

describe('MCP Tool Integration', () => {
  // Register real adapters to test them
  beforeAll(() => {
    // Re-register the adapters in case they were mocked elsewhere
    registerLlmAdapter('ollama', (config) => new OllamaAdapter(config));
    registerLlmAdapter('openai', (config) => new OpenAiAdapter(config));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Tool Format Compatibility', () => {
    it('should handle the same MCP tool formats in both OpenAI and Ollama adapters', async () => {
      // Create both adapters with their respective configs
      const ollamaConfig: LlmConfig = {
        provider: 'ollama',
        model: 'llama2',
      };
      const openaiConfig: LlmConfig = {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      };

      const ollamaAdapter = createLlmAdapter(ollamaConfig);
      const openaiAdapter = createLlmAdapter(openaiConfig);

      // Make sure both adapters have the correct type
      expect(ollamaAdapter).toBeInstanceOf(OllamaAdapter);
      expect(openaiAdapter).toBeInstanceOf(OpenAiAdapter);

      // Check if both adapters can handle the same tool format
      // We don't care about the actual API call results (they're mocked),
      // just that the format conversion doesn't throw errors
      await expect(ollamaAdapter.callModelWithTools('Test', sampleMcpTools)).resolves.toBeDefined();
      await expect(openaiAdapter.callModelWithTools('Test', sampleMcpTools)).resolves.toBeDefined();
    });

    it('should use OpenAI-compatible endpoint with Ollama when configured', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

      // Mock specific response for OpenAI compatibility endpoint
      mockFetch.mockImplementation((url) => {
        if (url.toString().includes('/v1/chat/completions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              choices: [
                {
                  message: {
                    content: 'OpenAI compatible response',
                    role: 'assistant',
                  },
                },
              ],
            }),
            text: () => Promise.resolve(''),
          } as NodeFetchResponse);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: 'Regular Ollama response' }),
          text: () => Promise.resolve(''),
        } as NodeFetchResponse);
      });

      // Create an Ollama adapter with OpenAI compatibility
      const ollamaCompatConfig: LlmConfig = {
        provider: 'ollama',
        model: 'llama3.1',
        baseUrl: 'http://localhost:11434/v1',
        useOpenAICompatibility: true,
      };

      const ollamaAdapter = createLlmAdapter(ollamaCompatConfig);
      const result = await ollamaAdapter.callModelWithTools('Test with OpenAI compatibility', sampleMcpTools);

      // Verify that the correct endpoint was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/chat\/completions$/),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );

      // Check that the response was properly parsed
      expect(result.content).toBe('OpenAI compatible response');
    });
  });

  describe('Tool Execution Flow', () => {
    it('should correctly convert OpenAI-style tool calls to MCP tool calls', async () => {
      // This test simulates the flow from OpenAI's tool calls to MCP tool invocation

      // Mock fetch to return a tool call
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [
            {
              message: {
                content: '',
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: JSON.stringify({ path: '/test.txt' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      // Create adapter and MCP client
      const openaiAdapter = createLlmAdapter({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      });

      const mcpClient = mockMcpClient(sampleMcpTools);

      // Simulate the flow
      const result = await openaiAdapter.callModelWithTools('Read a file', sampleMcpTools);

      // Verify we got a tool call
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.[0].name).toBe('read_file');
      expect(result.toolCalls?.[0].arguments).toEqual({ path: '/test.txt' });

      // Now simulate passing this to an MCP client
      if (result.toolCalls) {
        await mcpClient.callTool(result.toolCalls[0].name, result.toolCalls[0].arguments);
        expect(mcpClient.callTool).toHaveBeenCalledWith('read_file', { path: '/test.txt' });
      }
    });

    it('should correctly convert Ollama-style tool calls to MCP tool calls', async () => {
      // This test simulates the flow from Ollama's tool calls to MCP tool invocation

      // Mock fetch to return a response with a tool call in JSON format
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          response: 'I need to use a tool.\n```\n{"tool": "read_file", "parameters": {"path": "/test.txt"}}\n```\nAfter using the tool.',
        }),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      // Create adapter and MCP client
      const ollamaAdapter = createLlmAdapter({
        provider: 'ollama',
        model: 'llama2',
      });

      const mcpClient = mockMcpClient(sampleMcpTools);

      // Simulate the flow
      const result = await ollamaAdapter.callModelWithTools('Read a file', sampleMcpTools);

      // Verify we got a tool call
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.[0].name).toBe('read_file');
      expect(result.toolCalls?.[0].arguments).toEqual({ path: '/test.txt' });

      // Now simulate passing this to an MCP client
      if (result.toolCalls) {
        await mcpClient.callTool(result.toolCalls[0].name, result.toolCalls[0].arguments);
        expect(mcpClient.callTool).toHaveBeenCalledWith('read_file', { path: '/test.txt' });
      }
    });

    it('should handle multiple tool calls in a single response correctly', async () => {
      // Mock response with multiple tool calls
      const complexToolCallResponse = {
        response: 'I need to use multiple tools.\n'
          + '```\n{"tool": "read_file", "parameters": {"path": "/path/to/file"}}\n```\n'
          + 'Then I need to write the file.\n'
          + '```\n{"tool": "write_file", "parameters": {"path": "/path/to/file", "content": "new content"}}\n```\n'
          + 'This will complete the task.',
      };

      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(complexToolCallResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      // Create Ollama adapter and test with multi-tool response
      const ollamaAdapter = createLlmAdapter({
        provider: 'ollama',
        model: 'llama2',
      });

      const result = await ollamaAdapter.callModelWithTools('Use multiple tools', []);

      // With our enhanced implementation, we should now get both tool calls
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(2);

      // First tool call should be read_file
      expect(result.toolCalls?.[0].name).toBe('read_file');
      expect(result.toolCalls?.[0].arguments).toEqual({ path: '/path/to/file' });

      // Second tool call should be write_file
      expect(result.toolCalls?.[1].name).toBe('write_file');
      expect(result.toolCalls?.[1].arguments).toEqual({
        path: '/path/to/file',
        content: 'new content',
      });

      // The tool calls should be removed from the content
      expect(result.content).not.toContain('{"tool":');
    });
  });
});
