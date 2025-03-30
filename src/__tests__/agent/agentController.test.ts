import AgentController from '../../agent/agentController';
import { LlmConfig } from '../../llm/llmAdapter';
import McpRegistry from '../../mcp/mcpRegistry';
import McpClient from '../../mcp/mcpClient';

// Mock dependencies
jest.mock('../../llm/llmAdapter', () => {
  const originalModule = jest.requireActual('../../llm/llmAdapter');

  // Mock LLM adapter
  const mockAdapter = {
    callModelWithTools: jest.fn(),
  };

  return {
    ...originalModule,
    createLlmAdapter: jest.fn().mockReturnValue(mockAdapter),
  };
});

jest.mock('../../mcp/mcpClient');
jest.mock('../../mcp/mcpRegistry');
jest.mock('../../utils/logger', () => ({
  createLogger: jest.fn().mockReturnValue({
    verbose: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    tool: jest.fn(),
    close: jest.fn(),
  }),
}));

// Get mocked implementations
const { createLlmAdapter } = jest.requireMock('../../llm/llmAdapter');
const mockLlmAdapter = createLlmAdapter() as jest.Mocked<any>;
// We'll keep this import but mark it as intentionally unused with eslint-disable
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MockedMcpClient = McpClient as jest.MockedClass<typeof McpClient>;
const MockedMcpRegistry = McpRegistry as jest.MockedClass<typeof McpRegistry>;

describe('AgentController', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processUserInput', () => {
    it('should collect tools, call LLM, and handle responses without tool calls', async () => {
      // Setup mock clients with tools
      const mockClient1 = {
        getTools: jest.fn().mockResolvedValue([
          {
            name: 'read_file',
            description: 'Read a file from the filesystem',
            parameters: { properties: {}, required: [] },
          },
        ]),
        callTool: jest.fn(),
      };

      const mockClient2 = {
        getTools: jest.fn().mockResolvedValue([
          {
            name: 'write_file',
            description: 'Write to a file',
            parameters: { properties: {}, required: [] },
          },
        ]),
        callTool: jest.fn(),
      };

      // Setup MockRegistry
      const mockRegistry = new MockedMcpRegistry();
      mockRegistry.getAllClients = jest.fn().mockReturnValue(new Map([
        ['filesystem', mockClient1],
        ['memory', mockClient2],
      ]));

      // Mock LLM response with no tool calls
      mockLlmAdapter.callModelWithTools.mockResolvedValueOnce({
        content: 'This is a response without tool calls',
      });

      // Create controller and process input
      const controller = new AgentController({
        llmConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
        mcpRegistry: mockRegistry,
      });

      await controller.processUserInput('Test input');

      // Verify that tools were collected from both clients
      expect(mockClient1.getTools).toHaveBeenCalled();
      expect(mockClient2.getTools).toHaveBeenCalled();

      // Verify that LLM was called with combined tools
      expect(mockLlmAdapter.callModelWithTools).toHaveBeenCalledWith(
        'Test input',
        expect.arrayContaining([
          expect.objectContaining({ name: 'read_file' }),
          expect.objectContaining({ name: 'write_file' }),
        ]),
        undefined,
      );

      // Verify no tool calls were made
      expect(mockClient1.callTool).not.toHaveBeenCalled();
      expect(mockClient2.callTool).not.toHaveBeenCalled();
    });

    it('should handle tool calls correctly by routing to the appropriate MCP client', async () => {
      // Setup mock clients with tools
      const mockFilesystemClient = {
        getTools: jest.fn().mockResolvedValue([
          {
            name: 'read_file',
            description: 'Read a file from the filesystem',
            parameters: { properties: {}, required: [] },
          },
        ]),
        callTool: jest.fn().mockResolvedValue({ content: 'File content' }),
      };

      const mockMemoryClient = {
        getTools: jest.fn().mockResolvedValue([
          {
            name: 'remember',
            description: 'Store information in memory',
            parameters: { properties: {}, required: [] },
          },
        ]),
        callTool: jest.fn(),
      };

      // Setup MockRegistry
      const mockRegistry = new MockedMcpRegistry();
      mockRegistry.getAllClients = jest.fn().mockReturnValue(new Map([
        ['filesystem', mockFilesystemClient],
        ['memory', mockMemoryClient],
      ]));

      // Mock LLM response with a tool call
      mockLlmAdapter.callModelWithTools.mockResolvedValueOnce({
        content: 'Let me read that file for you',
        toolCalls: [
          {
            name: 'read_file',
            arguments: { path: '/path/to/file.txt' },
          },
        ],
      });

      // Create controller and process input
      const controller = new AgentController({
        llmConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
        mcpRegistry: mockRegistry,
      });

      await controller.processUserInput('Read my file.txt');

      // Verify that tools were collected
      expect(mockFilesystemClient.getTools).toHaveBeenCalled();
      expect(mockMemoryClient.getTools).toHaveBeenCalled();

      // Verify that the correct tool was called on the correct client
      expect(mockFilesystemClient.callTool).toHaveBeenCalledWith(
        'read_file',
        { path: '/path/to/file.txt' },
      );
      expect(mockMemoryClient.callTool).not.toHaveBeenCalled();
    });

    it('should handle errors when collecting tools from MCP servers', async () => {
      // Setup mock clients with one that throws an error
      const mockWorkingClient = {
        getTools: jest.fn().mockResolvedValue([
          {
            name: 'working_tool',
            description: 'A working tool',
            parameters: { properties: {}, required: [] },
          },
        ]),
        callTool: jest.fn(),
      };

      const mockFailingClient = {
        getTools: jest.fn().mockRejectedValue(new Error('Failed to get tools')),
        callTool: jest.fn(),
      };

      // Setup MockRegistry
      const mockRegistry = new MockedMcpRegistry();
      mockRegistry.getAllClients = jest.fn().mockReturnValue(new Map([
        ['working', mockWorkingClient],
        ['failing', mockFailingClient],
      ]));

      // Mock LLM response
      mockLlmAdapter.callModelWithTools.mockResolvedValueOnce({
        content: 'Response with no tool calls',
      });

      // Create controller and process input
      const controller = new AgentController({
        llmConfig: { provider: 'ollama', model: 'llama2' },
        mcpRegistry: mockRegistry,
      });

      await controller.processUserInput('Test input');

      // Verify that both clients were queried
      expect(mockWorkingClient.getTools).toHaveBeenCalled();
      expect(mockFailingClient.getTools).toHaveBeenCalled();

      // Verify that LLM was still called with tools from the working client
      expect(mockLlmAdapter.callModelWithTools).toHaveBeenCalledWith(
        'Test input',
        expect.arrayContaining([
          expect.objectContaining({ name: 'working_tool' }),
        ]),
        undefined,
      );
    });
  });

  describe('integration between adapters', () => {
    it('should correctly pass tools between MCP client and Ollama adapter', async () => {
      // This test verifies that the AgentController can correctly
      // orchestrate interactions between MCP clients and the Ollama adapter

      // First, replace our mock implementation with a more realistic one
      const originalCreateLlmAdapter = jest.requireActual('../../llm/llmAdapter').createLlmAdapter;
      createLlmAdapter.mockImplementation((config: LlmConfig) => {
        if (config.provider === 'ollama') {
          // Create a mock that simulates Ollama's behavior
          return {
            callModelWithTools: jest.fn((prompt, tools) => {
              // Check if the tools were formatted correctly in the prompt
              const toolsInPrompt = tools.length > 0 && prompt.includes('You have access to the following tools');

              // Return a response with a tool call if requested
              if (prompt.toLowerCase().includes('read file')) {
                return Promise.resolve({
                  content: 'Let me read that file',
                  toolCalls: [
                    {
                      name: 'read_file',
                      arguments: { path: '/test.txt' },
                    },
                  ],
                });
              }

              return Promise.resolve({
                content: `Ollama response for: ${prompt}${toolsInPrompt ? ' (with tools)' : ''}`,
              });
            }),
          };
        }

        return originalCreateLlmAdapter(config);
      });

      // Setup mock MCP client for filesystem
      const mockFilesystemClient = {
        getTools: jest.fn().mockResolvedValue([
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
              },
              required: ['path'],
            },
          },
        ]),
        callTool: jest.fn().mockResolvedValue({ content: 'File content from MCP' }),
      };

      // Setup MockRegistry
      const mockRegistry = new MockedMcpRegistry();
      mockRegistry.getAllClients = jest.fn().mockReturnValue(new Map([
        ['filesystem', mockFilesystemClient],
      ]));

      // Create controller with Ollama config
      const controller = new AgentController({
        llmConfig: { provider: 'ollama', model: 'llama2' },
        mcpRegistry: mockRegistry,
      });

      // Process input that should trigger a tool call
      await controller.processUserInput('Please read file test.txt');

      // Verify the filesystem tool was called
      expect(mockFilesystemClient.callTool).toHaveBeenCalledWith(
        'read_file',
        { path: '/test.txt' },
      );
    });
  });
});
