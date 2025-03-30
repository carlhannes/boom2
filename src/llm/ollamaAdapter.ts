import fetch from 'node-fetch';
import {
  LlmAdapter,
  LlmConfig,
  LlmResponse,
  registerLlmAdapter,
} from './llmAdapter';

/**
 * Adapter for the Ollama API using the native APIs for chat and tools
 */
class OllamaAdapter implements LlmAdapter {
  private baseUrl: string;

  private model: string;

  private useChat: boolean;

  constructor(config: LlmConfig) {
    // For testing environments, we want to use localhost
    // In production Docker environments, we want to use host.docker.internal
    if (process.env.NODE_ENV === 'test') {
      this.baseUrl = config.baseUrl || 'http://localhost:11434';
    } else {
      this.baseUrl = config.baseUrl || 'http://host.docker.internal:11434';
    }
    this.model = config.model || 'llama2';

    // Determine if we should use chat API (preferred for tool support)
    // We'll try to use chat API by default for better tool support
    this.useChat = true;
  }

  /**
   * Calls the Ollama API with tools
   * @param prompt The user's input prompt
   * @param tools Array of available tools
   * @param conversationId Conversation ID (not used in Ollama native API)
   */
  async callModelWithTools(
    prompt: string,
    tools: Array<any>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    try {
      if (this.useChat && tools.length > 0) {
        // Use the chat API with tools (newer, better approach)
        return this.callWithChatAPI(prompt, tools);
      }
      // Fallback to generate API (older approach)
      return this.callWithGenerateAPI(prompt, tools);
    } catch (error) {
      // If chat API fails, fallback to generate API
      console.error('Error using Ollama chat API, falling back to generate API:', error);
      this.useChat = false;
      return this.callWithGenerateAPI(prompt, tools);
    }
  }

  /**
   * Uses Ollama's native chat API with tools
   */
  private async callWithChatAPI(
    prompt: string,
    tools: Array<any>,
  ): Promise<LlmResponse> {
    // Format the system message for better instructions
    const systemMessage = `You are Boom2, an AI coding assistant designed to help developers with programming tasks and questions about codebases.
    
Your job is to:
1. Understand the user's question or request
2. Use available tools when needed to gather information or perform actions
3. Provide clear, concise, and accurate responses based on the information you find
4. Only use tools when necessary to answer the question`;

    // Convert tools to Ollama's expected format
    const formattedTools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {
          type: 'object',
          properties: {},
        },
      },
    }));

    // Call the chat API
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemMessage,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        tools: formattedTools.length > 0 ? formattedTools : undefined,
        stream: false,
        options: {
          num_ctx: 4096,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const result = await response.json();
    console.log('Ollama chat response:', result);

    // Extract content and tool calls
    const message = result.message || {};
    const content = message.content || '';
    let toolCalls;

    // Handle tool_calls from Ollama's response
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((toolCall: any) => ({
        name: toolCall.function.name,
        arguments: this.parseArguments(toolCall.function.arguments),
      }));
    }

    return {
      content,
      toolCalls,
    };
  }

  /**
   * Parse arguments which may be a string instead of an object
   */
  private parseArguments(args: string | object): Record<string, any> {
    if (typeof args === 'string') {
      try {
        return JSON.parse(args);
      } catch (e) {
        console.warn('Failed to parse tool arguments:', e);
        return {};
      }
    }
    return args as Record<string, any>;
  }

  /**
   * Uses Ollama's generate API with tools (legacy approach)
   */
  private async callWithGenerateAPI(
    prompt: string,
    tools: Array<any>,
  ): Promise<LlmResponse> {
    // Add a clear system prompt to explain the assistant's role and how to use tools
    const systemPrompt = `You are Boom2, an AI coding assistant designed to help developers with programming tasks and questions about codebases.

You work with the user in their project through a set of tools that allow you to read files, write code, run commands, and more.

Your job is to:
1. Understand the user's question or request
2. Use available tools when needed to gather information or perform actions
3. Provide clear, concise, and accurate responses based on the information you find
4. When using tools, use the exact JSON format provided in the tool instructions

Remember:
- You are helping with real code and projects - don't make up file contents or code that doesn't exist
- If you need to see code or files to answer a question, use the appropriate tools to access them
- Always respond to the user's actual question, not to the tools or prompts
- Keep your responses focused on the programming task at hand
- Use tools deliberately - only use them when needed to answer the question

USER QUERY: ${prompt}`;

    // Construct the enhanced prompt with tool information
    let enhancedPrompt = systemPrompt;
    if (tools.length > 0) {
      // Format tools as part of the prompt
      enhancedPrompt += '\n\nYou have access to the following tools:\n';
      for (const tool of tools) {
        enhancedPrompt += `\nTool: ${tool.name}\n`;
        enhancedPrompt += `Description: ${tool.description}\n`;
        // Format parameters
        if (tool.parameters && tool.parameters.properties) {
          enhancedPrompt += 'Parameters:\n';
          for (const [paramName, paramDetails] of Object.entries<any>(tool.parameters.properties)) {
            enhancedPrompt += `  - ${paramName}: ${paramDetails.description || 'No description'}\n`;
          }
        }
      }
      enhancedPrompt += '\nTo use a tool, respond in the following format:\n';
      enhancedPrompt += '```json\n{"tool": "tool_name", "parameters": {"param1": "value1", "param2": "value2"}}\n```\n';
      enhancedPrompt += 'If you don\'t need to use a tool, just respond directly to the user\'s question.';
      enhancedPrompt += '\nYou can use multiple tools by including multiple code blocks in this format.';
      enhancedPrompt += '\nOnly respond with tool calls if you need information to answer the user\'s question properly.';
    }

    // Call the Ollama API with native /api/generate endpoint
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: enhancedPrompt,
        stream: false,
        options: {
          num_ctx: 4096, // Set context size to 4096 for larger context window
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const result = await response.json();
    console.log('Ollama generate response:', result);

    // Extract the generated text
    const text = result.response;

    // Parse the response to check for tool calls
    return this.parseToolCallsFromResponse(text);
  }

  /**
   * Calls the Ollama API without tools
   */
  async callModel(
    prompt: string,
    conversationId?: string,
  ): Promise<LlmResponse> {
    return this.callModelWithTools(prompt, [], conversationId);
  }

  /**
   * Calls the Ollama API with tool results to get a final response
   */
  async callModelWithToolResults(
    originalPrompt: string,
    initialResponse: string,
    toolResults: Array<{ toolName: string; toolCall: any; result: any }>,
    conversationId?: string,
  ): Promise<LlmResponse> {
    try {
      if (this.useChat) {
        // Use the chat API for tool results (better approach)
        return this.callWithToolResultsChatAPI(originalPrompt, initialResponse, toolResults);
      }
      // Fallback to generate API
      return this.callWithToolResultsGenerateAPI(originalPrompt, initialResponse, toolResults);
    } catch (error) {
      console.error('Error using Ollama chat API for tool results, falling back to generate API:', error);
      this.useChat = false;
      return this.callWithToolResultsGenerateAPI(originalPrompt, initialResponse, toolResults);
    }
  }

  /**
   * Uses the chat API to follow up with tool results
   */
  private async callWithToolResultsChatAPI(
    originalPrompt: string,
    initialResponse: string,
    toolResults: Array<{ toolName: string; toolCall: any; result: any }>,
  ): Promise<LlmResponse> {
    // Format the system message
    const systemMessage = 'You are Boom2, an AI coding assistant designed to help developers understand and work with their code.';

    // Create the message history
    const messages = [
      {
        role: 'system',
        content: systemMessage,
      },
      {
        role: 'user',
        content: originalPrompt,
      },
    ];

    // Add assistant response with tool calls
    const assistantMessage: any = {
      role: 'assistant',
      content: initialResponse,
    };

    // Format tool calls in Ollama's expected format
    if (toolResults.length > 0) {
      assistantMessage.tool_calls = toolResults.map((result, index) => ({
        id: `call_${index}`,
        type: 'function',
        function: {
          name: result.toolName,
          arguments: JSON.stringify(result.toolCall.arguments),
        },
      }));
      messages.push(assistantMessage);

      // Add tool responses
      for (const [index, result] of toolResults.entries()) {
        let resultContent = '';

        // Format the result content
        if (result.result.isError) {
          resultContent = `Error: ${JSON.stringify(result.result.content)}`;
        } else if (result.result.content) {
          // Try to extract text content
          const textParts = result.result.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text);

          resultContent = textParts.join('\n');

          // If no text parts found, use the whole content
          if (!textParts.length) {
            resultContent = JSON.stringify(result.result.content);
          }
        } else {
          resultContent = JSON.stringify(result.result);
        }

        messages.push({
          role: 'tool',
          // tool_call_id: `call_${index}`,
          content: resultContent,
        });
      }
    } else {
      // If no tool results, just add the assistant's initial response
      messages.push(assistantMessage);
    }

    // Add the user's follow-up prompt asking for a detailed response
    messages.push({
      role: 'user',
      content: 'Please provide a complete and detailed response to my original question based on these tool results.',
    });

    // Call the Ollama chat API
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          num_ctx: 8192, // Increased context for handling tool results
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const result = await response.json();
    console.log('Ollama chat response with tool results:', result);

    // Extract content and possible tool calls from the final response
    const message = result.message || {};
    const content = message.content || '';
    let toolCalls;

    // Handle possible follow-up tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((toolCall: any) => ({
        name: toolCall.function.name,
        arguments: this.parseArguments(toolCall.function.arguments),
      }));
    }

    return {
      content,
      toolCalls,
    };
  }

  /**
   * Legacy method using generate API for tool results
   */
  private async callWithToolResultsGenerateAPI(
    originalPrompt: string,
    initialResponse: string,
    toolResults: Array<{ toolName: string; toolCall: any; result: any }>,
  ): Promise<LlmResponse> {
    // Format a new prompt that includes the original prompt, initial response, and tool results
    let enhancedPrompt = `You are Boom2, an AI coding assistant designed to help developers understand and work with their code.

IMPORTANT INFORMATION:
- The user asked: "${originalPrompt}"
- You requested information using tools
- I've executed the tools you requested and have the results below
- Your job now is to provide a COMPLETE and HELPFUL response based on these tool results

Your initial thoughts were: "${initialResponse}"

Here are the results from the tools you requested:
`;

    // Add each tool result with clear formatting
    for (const { toolName, toolCall, result } of toolResults) {
      enhancedPrompt += `\n--- TOOL: ${toolName} ---\n`;
      enhancedPrompt += `PARAMETERS: ${JSON.stringify(toolCall.arguments, null, 2)}\n`;

      // Format the result to be more readable
      let resultText = '';
      if (result.isError) {
        resultText = `ERROR: ${JSON.stringify(result.content)}`;
      } else if (result.content) {
        // Try to extract the text content from the response
        const textParts = result.content
          .filter((item: any) => item.type === 'text')
          .map((item: any) => item.text);

        resultText = textParts.join('\n');

        // If no text parts found, use the whole content
        if (!textParts.length) {
          resultText = JSON.stringify(result.content, null, 2);
        }
      } else {
        resultText = JSON.stringify(result, null, 2);
      }

      enhancedPrompt += `RESULT:\n${resultText}\n`;
    }

    enhancedPrompt += `\nNow, please provide a comprehensive answer to the user's original question: "${originalPrompt}"

Based on the tool results above, explain clearly and directly. Focus on answering the question completely.

If the tools returned errors or insufficient information:
1. Acknowledge this in your response
2. Explain what information was missing
3. Suggest alternative approaches

If the tools returned useful information:
1. Synthesize the information clearly
2. Provide direct answers with specific details from the results
3. Format code snippets or file contents appropriately if relevant

You may use tools again if needed by including JSON in this format:
\`\`\`json
{"tool": "tool_name", "parameters": {"param1": "value1"}}
\`\`\`

IMPORTANT: Your response should be thoughtful, comprehensive and directly answer the user's original question. Don't include phrases like "based on the tool results" - just provide the answer as if you naturally knew the information.`;

    // Call the Ollama API with the enhanced prompt
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: enhancedPrompt,
        stream: false,
        options: {
          num_ctx: 8192, // Increased context window for better handling of tool results
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const result = await response.json();
    console.log('Ollama generate response with tool results:', result);

    // Extract the generated text
    const text = result.response;

    // Parse the response to check for additional tool calls
    return this.parseToolCallsFromResponse(text);
  }

  /**
   * Parses the LLM response text to extract tool calls
   * This is needed for the legacy generate API approach
   */
  private parseToolCallsFromResponse(text: string): LlmResponse {
    const response: LlmResponse = {
      content: text,
    };

    // Look for all JSON tool calls in the response using a global regex
    // This improved pattern matches code blocks with or without language specifiers like ```json
    const jsonPattern = /```(?:json)?\s*\n([\s\S]*?)\n```/gs;
    const matches = [...text.matchAll(jsonPattern)];

    if (matches.length > 0) {
      const toolCalls = [];
      let modifiedContent = text;

      for (const match of matches) {
        try {
          let jsonString = match[1];

          // Log the original string for debugging
          console.log('Original JSON string:', jsonString);

          // Make sure we're only trying to parse valid JSON objects
          // Trim whitespace and check if it looks like a JSON object
          jsonString = jsonString.trim();
          if (!jsonString.startsWith('{') || !jsonString.endsWith('}')) {
            console.log('JSON string has incomplete braces, attempting to fix');
            // If the JSON string is missing the closing brace, add it
            if (jsonString.startsWith('{') && !jsonString.endsWith('}')) {
              jsonString = `${jsonString}}`;
            }
          }

          // Fix for double braces with embedded quotes issue
          // First, handle the outer double braces - this is a key fix for Qwen model
          if (jsonString.startsWith('{{') && jsonString.endsWith('}}')) {
            jsonString = jsonString.substring(1, jsonString.length - 1);
          } else if (jsonString.startsWith('{{')) {
            // Handle case where only opening double braces were added
            jsonString = jsonString.substring(1);
          } else if (jsonString.endsWith('}}')) {
            // Handle case where only closing double braces were added
            jsonString = jsonString.substring(0, jsonString.length - 1);
          }

          // Then fix embedded double braces with quotes like {{"param1":"value"}}
          // More robust regex to handle various embedded double brace patterns
          jsonString = jsonString.replace(/{{\s*"([^"]*)":/g, '{"$1":');
          jsonString = jsonString.replace(/:\s*{{/g, ':{');
          jsonString = jsonString.replace(/}},/g, '},');
          jsonString = jsonString.replace(/}}(\s*})/g, '}$1');

          // Handle any remaining double braces
          jsonString = jsonString.replace(/{{/g, '{');
          jsonString = jsonString.replace(/}}/g, '}');

          // Ensure the JSON string is properly formatted with balanced braces
          const openBraces = (jsonString.match(/{/g) || []).length;
          const closeBraces = (jsonString.match(/}/g) || []).length;
          if (openBraces > closeBraces) {
            // Add missing closing braces
            jsonString += '}'.repeat(openBraces - closeBraces);
          } else if (closeBraces > openBraces) {
            // Add missing opening braces at the beginning
            jsonString = '{'.repeat(closeBraces - openBraces) + jsonString;
          }

          console.log('Attempting to parse JSON:', jsonString);
          const toolCallData = JSON.parse(jsonString);

          // Handle different tool call formats:
          // 1. Standard format: {"tool": "tool_name", "parameters": {...}}
          // 2. Map format: {"tool_name_1": {...}, "tool_name_2": {...}}

          if (toolCallData.tool) {
            // Standard format - add with parameter mapping
            const mappedArguments = this.mapToolParameters(
              toolCallData.tool,
              toolCallData.parameters || {},
            );

            toolCalls.push({
              name: toolCallData.tool,
              arguments: mappedArguments,
            });
          } else {
            // Try the map format where tool names are keys
            const toolNames = Object.keys(toolCallData);
            for (const toolName of toolNames) {
              if (typeof toolCallData[toolName] === 'object') {
                const mappedArguments = this.mapToolParameters(
                  toolName,
                  toolCallData[toolName] || {},
                );

                toolCalls.push({
                  name: toolName,
                  arguments: mappedArguments,
                });
              }
            }
          }

          // Remove the tool call from the content
          modifiedContent = modifiedContent.replace(match[0], '');
        } catch (error) {
          // Log more detailed error information for debugging
          console.warn('Failed to parse tool call JSON:', error);
          if (match && match[1]) {
            console.warn('Original JSON string:', match[1]);
          }
        }
      }

      if (toolCalls.length > 0) {
        response.toolCalls = toolCalls;
        response.content = modifiedContent.trim();
        console.log(`Found ${toolCalls.length} tool call(s) in Ollama response:`, toolCalls);
      }
    }

    return response;
  }

  /**
   * Maps parameter names from LLM output to what MCP servers expect
   * This handles cases where the LLM uses a different parameter name than what the server expects
   */
  private mapToolParameters(toolName: string, parameters: Record<string, any>): Record<string, any> {
    const parameterMappings: Record<string, Record<string, string>> = {
      read_file: {
        file_path: 'path',
      },
      read_multiple_files: {
        file_paths: 'paths',
      },
      write_file: {
        file_path: 'path',
      },
      search_files: {
        directory_path: 'path',
      },
      list_directory: {
        directory_path: 'path',
      },
      // Add other mappings as needed
    };

    const result = { ...parameters };
    const mapping = parameterMappings[toolName];

    if (mapping) {
      // Apply mapping for this specific tool
      for (const [fromParam, toParam] of Object.entries(mapping)) {
        if (parameters[fromParam] !== undefined) {
          result[toParam] = parameters[fromParam];
          delete result[fromParam]; // Remove the original parameter
        }
      }
    }

    return result;
  }
}

// Register this adapter with the factory
registerLlmAdapter('ollama', (config) => new OllamaAdapter(config));

export default OllamaAdapter;
