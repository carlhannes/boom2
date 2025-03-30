# Boom2 - Autonomous Coding Agent

Boom2 is an autonomous coding agent that runs in a Docker container and provides access to AI-powered coding assistance through Model Context Protocol (MCP) servers. It supports multiple LLM providers including OpenAI, Ollama (for local models), and Anthropic.

## Features

- **Docker-based**: Run a single command to start the agent in a containerized environment
- **MCP Servers**:
  - Filesystem access (read/write files in your project)
  - Memory (persistent conversation context)
  - Shell execution (run commands in the container)
- **Multiple LLM Support**: 
  - OpenAI (GPT-4, GPT-3.5)
  - Ollama (local models like Llama2)
  - Anthropic (Claude models)
- **Interactive CLI**: Simple chat-based interface for coding assistance
- **Persistent Configuration**: Settings stored in `.boom2.conf` and memory in `.boom2/memory-graph.json`

## Prerequisites

- Docker installed on your system
- For local models: Ollama running on your host machine

## Quick Start

### Build the Docker Image

```bash
# Clone the repository
git clone https://github.com/your-username/boom2.git
cd boom2

# Build the Docker image
docker build -t boom2 .
```

### Run Boom2 in Your Project

Navigate to your project directory and run:

```bash
docker run -it --rm \
  -v $(pwd):/home/node/project \
  -w /home/node/project \
  boom2
```

On first run, Boom2 will guide you through setting up your preferred LLM configuration.

### Enabling Verbose Mode

If you want to see detailed logs of tool execution and LLM interactions:

```bash
docker run -it --rm \
  -v $(pwd):/home/node/project \
  -w /home/node/project \
  boom2 start --verbose
```

When running in verbose mode, logs will also be saved to `.boom2/logs/<datetime>.log` in your project directory.

## Configuration

Boom2 looks for a `.boom2.conf` file in your project directory. If none exists, it will prompt you to create one on first run.

Example configuration:

```json
{
  "llm": {
    "provider": "openai",
    "apiKey": "sk-your-api-key",
    "model": "gpt-4"
  },
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "DATA_PATH": ".boom2/memory-graph.json"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/node/project"]
    },
    "shell": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-shell-exec"],
      "env": {
        "ALLOWED_COMMANDS": "npm,node,python,pip"
      }
    }
  },
  "verbose": false
}
```

### Memory Persistence

The Memory MCP server's data is automatically persisted to `.boom2/memory-graph.json` in your project directory. This ensures that conversations and context are maintained between container restarts.

## Using Boom2

Once running, you'll see a prompt where you can ask coding-related questions or give commands:

```
boom2> Help me understand the structure of this project
```

Boom2 will use the configured LLM to understand your request and leverage the MCP servers to:
- Read and analyze your codebase
- Modify or create files when needed
- Run shell commands for tasks like installing dependencies
- Remember context from your conversation

## Using with Ollama

To use Boom2 with local Ollama models:

1. Install and run [Ollama](https://ollama.ai/) on your host machine
2. Make sure your Ollama API is accessible from Docker (typically on localhost:11434)
3. When configuring Boom2, select Ollama as the provider

To allow Docker to access your host's Ollama instance:

```bash
docker run -it --rm \
  -v $(pwd):/home/node/project \
  -w /home/node/project \
  --network host \
  boom2
```

Alternatively, if you're using a remote Ollama instance, specify the base URL during configuration:

```json
{
  "llm": {
    "provider": "ollama",
    "model": "llama2",
    "baseUrl": "http://your-ollama-host:11434"
  },
  // Other configuration...
}
```

## Development

### Project Structure

```
boom2/
├─ Dockerfile
├─ package.json
├─ tsconfig.json
├─ src/
│   ├─ cli/
│   │   ├─ cli.ts          # Entry point for the interactive CLI
│   │   └─ config.ts       # Configuration management
│   ├─ mcp/
│   │   ├─ servers.ts      # MCP server management
│   │   ├─ mcpRegistry.ts  # Registry of available MCP servers
│   │   ├─ mcpClient.ts    # Client for interacting with MCP servers
│   │   └─ shellExec.ts    # Custom shell execution MCP server
│   ├─ llm/
│   │   ├─ llmAdapter.ts   # Common interface for LLM providers
│   │   ├─ openAiAdapter.ts
│   │   ├─ ollamaAdapter.ts
│   │   └─ anthropicAdapter.ts
│   └─ agent/
│       └─ agentController.ts # Orchestrates conversation & decides tool usage
├─ bin/
│   └─ boom2.js             # CLI entry point
```

### Building from Source

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Check our [ROADMAP.md](./ROADMAP.md) file for planned features and development priorities.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
