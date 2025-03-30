import fetch, { Response as NodeFetchResponse } from 'node-fetch';
import OpenAiAdapter from '../../llm/openAiAdapter';
import { LlmConfig } from '../../llm/llmAdapter';

// Mock the node-fetch module
jest.mock('node-fetch');
const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('OpenAiAdapter', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockConfig: LlmConfig = {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'test-api-key',
  };

  describe('callModelWithTools', () => {
    it('should format tools correctly for OpenAI API', async () => {
      // Mock successful response from OpenAI
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'This is a test response',
              role: 'assistant',
            },
          },
        ],
      };

      // Setup the fetch mock with properly typed response
      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OpenAiAdapter(mockConfig);
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
      expect(mockedFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
        body: expect.any(String),
      });

      // The request payload should have tools properly formatted
      const requestBody = JSON.parse(mockedFetch.mock.calls[0][1]!.body as string);
      expect(requestBody.tools).toHaveLength(1);
      expect(requestBody.tools[0].type).toBe('function');
      expect(requestBody.tools[0].function.name).toBe('test_tool');
      expect(requestBody.tools[0].function.description).toBe('A test tool');
      expect(requestBody.tools[0].function.parameters).toEqual({
        properties: {
          param1: {
            description: 'Parameter 1',
            type: 'string',
          },
        },
        required: ['param1'],
      });

      // Verify the response is formatted correctly
      expect(result).toEqual({
        content: 'This is a test response',
      });
    });

    it('should handle tool calls in the response correctly', async () => {
      // Mock response with a tool call
      const mockToolCallResponse = {
        choices: [
          {
            message: {
              content: '', // Often content is empty when tool_calls are present
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

      // Setup the fetch mock with properly typed response
      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockToolCallResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OpenAiAdapter(mockConfig);
      const result = await adapter.callModelWithTools('Use a tool', []);

      // Verify that the tool call was extracted correctly
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('test_tool');
      expect(result.toolCalls?.[0].arguments).toEqual({ param1: 'value1' });
    });

    it('should maintain conversation context when provided a conversation ID', async () => {
      // Mock first response with assistant message that will be stored
      const mockFirstResponse = {
        choices: [
          {
            message: {
              content: 'First response',
              role: 'assistant',
            },
          },
        ],
      };

      // Mock second response
      const mockSecondResponse = {
        choices: [
          {
            message: {
              content: 'Second response',
              role: 'assistant',
            },
          },
        ],
      };

      // Setup first mock response
      mockedFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockFirstResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      // Setup second mock response
      mockedFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockSecondResponse),
        text: () => Promise.resolve(''),
      } as NodeFetchResponse));

      const adapter = new OpenAiAdapter(mockConfig);

      // First call with a conversation ID
      await adapter.callModelWithTools('First message', [], 'test-convo');

      // Second call with the same conversation ID
      await adapter.callModelWithTools('Second message', [], 'test-convo');

      // Extract request bodies
      const firstRequestBody = JSON.parse(mockedFetch.mock.calls[0][1]!.body as string);
      const secondRequestBody = JSON.parse(mockedFetch.mock.calls[1][1]!.body as string);

      // First request should have system + user message (2 messages)
      expect(firstRequestBody.messages.length).toBe(2);
      expect(firstRequestBody.messages[0].role).toBe('system');
      expect(firstRequestBody.messages[1].role).toBe('user');
      expect(firstRequestBody.messages[1].content).toBe('First message');

      // Second request should include previous assistant message and new user message
      expect(secondRequestBody.messages.length).toBe(3); // system + prev assistant + new user

      // Verify messages are in the right order, with types we need
      const assistantMessage = secondRequestBody.messages.find((msg: any) => msg.role === 'assistant');
      const userMessage = secondRequestBody.messages.find((msg: any) => msg.role === 'user' && msg.content === 'Second message');
      const systemMessage = secondRequestBody.messages.find((msg: any) => msg.role === 'system');

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toBe('First response');
      expect(userMessage).toBeDefined();
      expect(systemMessage).toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      // Mock an error response
      mockedFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        text: () => Promise.resolve('API Error'),
      } as NodeFetchResponse));

      const adapter = new OpenAiAdapter(mockConfig);

      // The adapter should throw an error
      await expect(adapter.callModelWithTools('Test prompt', [])).rejects.toThrow('OpenAI API error: API Error');
    });
  });
});
