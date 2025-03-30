# Boom2 Project Roadmap

This document outlines the current state of the boom2 project and future development plans.

## Current State

Boom2 is an autonomous coding agent that runs in a Docker container and provides AI-powered coding assistance through Model Context Protocol (MCP) servers. Below is the status of planned features:

### Core Framework
- [x] Project structure setup (using TypeScript)
- [x] Basic CLI interface implementation
- [x] Configuration management
- [x] Agent controller for orchestrating interactions

### LLM Support
- [x] Abstract LLM adapter interface
- [x] OpenAI adapter implementation
- [x] Anthropic (Claude) adapter implementation
- [x] Ollama adapter implementation
- [ ] Streaming support for real-time responses - *In progress*

### MCP Integration
- [x] MCP Registry for managing server connections
- [x] MCP Client for tool invocation
- [x] Support for starting and stopping MCP servers
- [x] Filesystem MCP server integration
- [x] Memory MCP server integration
- [x] Shell execution capability

### Docker Environment
- [x] Basic Dockerfile for containerization
- [ ] Optimized Docker image with caching layers - *In progress*
- [ ] Documentation for volume mounting and container networking

### User Experience
- [x] Interactive CLI with proper formatting
- [x] Configuration wizard for first-time setup
- [x] Verbose logging mode
- [x] Session logs saved to project directory when in verbose mode

### Documentation
- [x] Basic README with project overview
- [ ] Comprehensive usage examples
- [ ] API documentation for extensibility
- [ ] Troubleshooting guide

### Testing
- [ ] Unit tests for core components
- [ ] Integration tests for MCP server interactions
- [ ] Docker container tests

## Upcoming Features

### Short-term Goals (Next Release)
1. Complete streaming support for LLM responses
2. Implement advanced error handling and recovery
3. Improve Docker image with layered caching for faster builds
4. Add unit tests for core functionality
5. Fix code style and ESLint issues

### Medium-term Goals
1. Add support for additional MCP servers (e.g., GitHub, database access)
2. Implement parallel tool execution for improved performance
3. Add support for custom user-defined MCP servers
4. Develop a configuration UI (web-based or TUI)
5. Support for agent plugins/extensions

### Long-term Vision
1. Multi-agent collaboration framework
2. Integration with popular IDEs (VS Code extension, JetBrains plugin)
3. Performance optimizations for large codebases
4. Advanced codebase analysis tools
5. Support for more specialized coding assistants (e.g., refactoring, test generation)

## Contributing

Contributions are welcome! Please check the open issues for areas where help is needed, or feel free to suggest new features that align with the roadmap.

## Feedback and Suggestions

If you have suggestions for this roadmap or want to discuss the priorities, please open an issue with the tag `roadmap-feedback`.