import fetch, { Response as NodeFetchResponse } from 'node-fetch';
import OllamaAdapter from '../../llm/ollamaAdapter';
import { LlmConfig } from '../../llm/llmAdapter';

// Mock the node-fetch module
jest.mock('node-fetch');
const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('OllamaAdapter', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockConfig: LlmConfig = {
    provider: 'ollama',
    model: 'llama2',
  };

  describe('callModelWithTools', () => {
    it('should format tools in the prompt and send request to Ollama API', async () => {
      // Mock successful response from Ollama
      const mockResponse = {
        response: 'This is a test response',
      };

      // Setup the fetch mock with properly typed response
      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OllamaAdapter(mockConfig);
      const tools = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            properties: {
              param1: {
                description: 'Parameter 1',
                type: 'string',
              },
            },
            required: ['param1'],
          },
        },
      ];

      const result = await adapter.callModelWithTools('Test prompt', tools);

      // Verify that fetch was called with the correct URL and payload
      expect(mockedFetch).toHaveBeenCalledWith('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('Test prompt'),
      });

      // The request payload should include tool information in the prompt
      const requestBody = JSON.parse(mockedFetch.mock.calls[0][1]!.body as string);
      expect(requestBody.prompt).toContain('test_tool');
      expect(requestBody.prompt).toContain('A test tool');
      expect(requestBody.prompt).toContain('param1');
      expect(requestBody.prompt).toContain('Parameter 1');

      // Verify the response is formatted correctly
      expect(result).toEqual({
        content: 'This is a test response',
      });
    });

    it('should parse tool calls from the response correctly', async () => {
      // Mock response with a tool call in JSON format
      const toolCallResponse = {
        response: 'I need to use a tool.\n```\n{"tool": "test_tool", "parameters": {"param1": "value1"}}\n```\nAfter using the tool.',
      };

      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(toolCallResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OllamaAdapter(mockConfig);
      const result = await adapter.callModelWithTools('Use a tool', []);

      // Verify that the tool call was parsed correctly
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('test_tool');
      expect(result.toolCalls?.[0].arguments).toEqual({ param1: 'value1' });

      // Verify that the tool call was removed from the content
      expect(result.content).not.toContain('{"tool": "test_tool"');
    });

    it('should handle API errors gracefully', async () => {
      // Mock an error response
      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        text: () => Promise.resolve('API Error'),
      } as NodeFetchResponse));

      const adapter = new OllamaAdapter(mockConfig);

      // The adapter should throw an error
      await expect(adapter.callModelWithTools('Test prompt', [])).rejects.toThrow('Ollama API error: API Error');
    });

    it('should format OpenAI-style tools correctly for Ollama', async () => {
      // Mock successful response from Ollama
      const mockResponse = {
        response: 'Test response',
      };

      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OllamaAdapter(mockConfig);

      // Define tools in OpenAI format that might come from MCP servers
      const openAiStyleTools = [
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

      await adapter.callModelWithTools('Use filesystem tools', openAiStyleTools);

      // Verify the request body was formatted properly
      const requestBody = JSON.parse(mockedFetch.mock.calls[0][1]!.body as string);
      const promptText = requestBody.prompt;

      // Check that both tools were included
      expect(promptText).toContain('read_file');
      expect(promptText).toContain('write_file');

      // Check that parameters were formatted correctly
      expect(promptText).toContain('path: The path to the file');
      expect(promptText).toContain('content: The content to write');

      // Check that the format instructions were included
      expect(promptText).toContain('To use a tool, respond in the following format:');
      expect(promptText).toContain('```');
      expect(promptText).toContain('{{"tool": "tool_name", "parameters": {{"param1": "value1", "param2": "value2"}}}}');
    });

    it('should handle multiple tool calls in a single response', async () => {
      // Mock response with multiple tool calls
      const complexToolCallResponse = {
        response: 'I need to use multiple tools.\n'
          + '```\n{"tool": "read_file", "parameters": {"path": "/path/to/file"}}\n```\n'
          + 'Then I need to write the file.\n'
          + '```\n{"tool": "write_file", "parameters": {"path": "/path/to/file", "content": "new content"}}\n```\n'
          + 'This will complete the task.',
      };

      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(complexToolCallResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OllamaAdapter(mockConfig);
      const result = await adapter.callModelWithTools('Use multiple tools', []);

      // With our enhanced implementation, we now get both tool calls (no longer just the first one)
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

    it('should use the OpenAI-compatible endpoint if available', async () => {
      // Mock successful response from Ollama OpenAI-compatible endpoint
      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'This is a test response',
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ param1: 'value1' }),
                  },
                },
              ],
            },
          },
        ],
      };

      // Set up Ollama with OpenAI compatibility
      const ollamaWithOpenAIConfig: LlmConfig = {
        provider: 'ollama',
        model: 'llama3.1',
        baseUrl: 'http://localhost:11434/v1',
        useOpenAICompatibility: true, // This is a new property we need to add to LlmConfig
      };

      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      // We'll need to update the OllamaAdapter implementation to support this
      // For now, just test that it's using the right URL format
      const adapter = new OllamaAdapter(ollamaWithOpenAIConfig);
      const result = await adapter.callModelWithTools('Test OpenAI compatibility', []);

      // Verify we're using the OpenAI-compatible endpoint
      expect(mockedFetch).toHaveBeenCalledWith(
        expect.stringMatching(/v1\/chat\/completions$/),
        expect.anything(),
      );

      // Verify that the tool call was extracted correctly
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('test_tool');
      expect(result.toolCalls?.[0].arguments).toEqual({ param1: 'value1' });
    });
  });
});
