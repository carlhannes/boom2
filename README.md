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
2. Make sure your Ollama API is accessible from Docker 
3. When configuring Boom2, select Ollama as the provider

### Connecting Docker to Host's Ollama Instance

When running in Docker, `localhost` refers to the container itself, not your host machine. Boom2 uses `host.docker.internal` by default, which works on Docker for Mac and Windows without any configuration.

```bash
docker run -it --rm \
  -v $(pwd):/home/node/project \
  -w /home/node/project \
  boom2
```

The default Ollama API URL will be `http://host.docker.internal:11434`, which should connect to your host machine's Ollama instance automatically on Mac and Windows.

#### For Linux Users

On Linux, `host.docker.internal` might not work by default. You have two options:

1. **Use host network mode**:
   ```bash
   docker run -it --rm \
     -v $(pwd):/home/node/project \
     -w /home/node/project \
     --network host \
     boom2
   ```
   When prompted, change the Ollama API URL to `http://localhost:11434`

2. **Add host.docker.internal manually**:
   ```bash
   docker run -it --rm \
     -v $(pwd):/home/node/project \
     -w /home/node/project \
     --add-host=host.docker.internal:host-gateway \
     boom2
   ```
   This adds the host.docker.internal DNS name to the container, making it work like on Mac/Windows.

3. **Use your host's IP address**:
   ```bash
   # Find your host IP address
   ip addr show | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1'
   
   # Then use that IP when prompted, e.g.:
   # http://192.168.1.100:11434
   ```

### Ollama Configuration Options

You can customize how Boom2 interacts with Ollama in your `.boom2.conf`:

```json
{
  "llm": {
    "provider": "ollama",
    "model": "llama2",
    "baseUrl": "http://host.docker.internal:11434",
    "useOpenAICompatibility": false
  },
  // Other configuration...
}
```

#### OpenAI Compatibility Mode

Ollama now supports OpenAI's function calling API with compatible models. Enable this with:

```json
{
  "llm": {
    "provider": "ollama",
    "model": "llama3.1",
    "baseUrl": "http://host.docker.internal:11434/v1",
    "useOpenAICompatibility": true
  }
}
```

This mode works best with:
- Llama 3.1 and other models that support OpenAI's tool/function calling protocol
- Requires using `/v1` in the baseUrl to access Ollama's OpenAI-compatible endpoint
- Provides more reliable tool usage than the standard prompt-based approach

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

Note: The compiled TypeScript code is output directly to the `dist` directory (not `dist/src`), as configured in `tsconfig.json`. References to compiled files should use paths like `dist/cli/cli.js` rather than `dist/src/cli/cli.js`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Check our [ROADMAP.md](./ROADMAP.md) file for planned features and development priorities.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

If you encounter issues, try these steps:

1. Check if the `.boom2.conf` file is correctly configured.
2. Verify that Docker has sufficient permissions to access your project directory.
3. For Ollama connection issues, make sure Ollama is running on your host and accessible from Docker.

### Common issues and solutions:

#### "No adapter registered for provider: ollama"
- This usually means that the LLM adapters weren't properly loaded. 
- Verify that you're using the latest version of boom2.

#### Connection refused errors with MCP servers
- MCP servers run as child processes within the container.
- If you're seeing connection errors, try the following:
  1. Delete any existing `.boom2.json` file and let the container create a new one
  2. Look for startup messages in the logs to see if servers are running on stdio instead of HTTP
  3. Try running with `--rm` to ensure you're starting with a clean container each time
  4. For advanced troubleshooting, run with `--verbose` flag to see detailed logs

#### Incorrect paths in Docker
- Remember that the container maps your current directory to `/home/node/project`.
- All paths inside the container should be relative to this location.
