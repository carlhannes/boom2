import axios from 'axios';
import McpClient from '../../mcp/mcpClient';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('McpClient', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockBaseUrl = 'http://localhost:8080';

  describe('loadTools', () => {
    it('should load tools from the MCP server', async () => {
      // Mock the tools response
      const mockTools = {
        tools: [
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
                  description: 'The content to write to the file',
                },
              },
              required: ['path', 'content'],
            },
          },
        ],
      };

      // Setup axios mock
      mockedAxios.get.mockResolvedValueOnce({ data: mockTools });

      // Create client and load tools
      const client = new McpClient(mockBaseUrl);
      await client.loadTools();

      // Verify that axios was called with the correct URL
      expect(mockedAxios.get).toHaveBeenCalledWith('http://localhost:8080/tools');

      // Get the tools and verify they match the mock data
      const tools = await client.getTools();
      expect(tools).toEqual(mockTools.tools);
      expect(tools.length).toBe(2);
    });

    it('should only load tools once', async () => {
      // Mock the tools response
      mockedAxios.get.mockResolvedValue({ data: { tools: [] } });

      // Create client and load tools twice
      const client = new McpClient(mockBaseUrl);
      await client.loadTools();
      await client.loadTools();

      // Verify that axios was called only once
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when loading tools', async () => {
      // Mock an error response
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      // Create client with minimal retry settings to speed up test
      const client = new McpClient(mockBaseUrl);

      // The client should throw an error
      await expect(client.loadTools(1, 10)).rejects.toThrow('Failed to load tools from MCP server');
    });
  });

  describe('invokeTool', () => {
    it('should call the tool on the MCP server', async () => {
      // Mock the tools response and the invoke response
      const mockTools = {
        tools: [
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
        ],
      };

      const mockInvokeResponse = {
        content: 'File content',
      };

      // Setup axios mocks with clear reset between calls
      mockedAxios.get.mockReset();
      mockedAxios.post.mockReset();

      mockedAxios.get.mockResolvedValue({ data: mockTools });
      mockedAxios.post.mockResolvedValue({ data: mockInvokeResponse });

      // Create client, load tools, and invoke a tool
      const client = new McpClient(mockBaseUrl);
      await client.loadTools();
      const result = await client.invokeTool('read_file', { path: '/path/to/file' });

      // Verify that axios was called with the correct URL and payload
      expect(mockedAxios.post).toHaveBeenCalledWith('http://localhost:8080/invoke', {
        tool: 'read_file',
        arguments: { path: '/path/to/file' },
      });

      // Verify the result
      expect(result).toEqual(mockInvokeResponse);
    });

    it('should throw an error if the tool does not exist', async () => {
      // Mock an empty tools response
      mockedAxios.get.mockResolvedValueOnce({ data: { tools: [] } });

      // Create client, load tools, and attempt to invoke a non-existent tool
      const client = new McpClient(mockBaseUrl);
      await client.loadTools();

      // The client should throw an error
      await expect(client.invokeTool('non_existent_tool', {})).rejects.toThrow(
        "Tool 'non_existent_tool' is not available on the MCP server",
      );
    });

    it('should handle errors when invoking a tool', async () => {
      // Mock the tools response but an error for the invoke
      const mockTools = {
        tools: [
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
        ],
      };

      // Setup axios mocks with clear reset
      mockedAxios.get.mockReset();
      mockedAxios.post.mockReset();

      mockedAxios.get.mockResolvedValue({ data: mockTools });
      mockedAxios.post.mockRejectedValue(new Error('Tool execution failed'));

      // Create client, load tools, and attempt to invoke a tool that fails
      const client = new McpClient(mockBaseUrl);
      await client.loadTools();

      // The client should throw an error
      await expect(client.invokeTool('read_file', { path: '/path/to/file' })).rejects.toThrow(
        "Failed to invoke tool 'read_file'",
      );
    });
  });

  describe('compatibility with LLM adapters', () => {
    it('should provide tools in a format compatible with LLM adapters', async () => {
      // Mock the tools response
      const mockTools = {
        tools: [
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
        ],
      };

      // Setup axios mock
      mockedAxios.get.mockResolvedValueOnce({ data: mockTools });

      // Create client and load tools
      const client = new McpClient(mockBaseUrl);
      await client.loadTools();
      const tools = await client.getTools();

      // Verify the tools have the correct format for OpenAI
      expect(tools[0].name).toBe('read_file');
      expect(tools[0].description).toBe('Read a file from the filesystem');
      expect(tools[0].parameters.type).toBe('object');
      expect(tools[0].parameters.properties.path.type).toBe('string');
      expect(tools[0].parameters.required).toContain('path');

      // This same format is also compatible with our Ollama adapter
      // which will transform it into the format expected by Ollama
    });
  });
});
