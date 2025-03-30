#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { loadConfig } from './config';
import AgentController from '../agent/agentController';
import startMcpServers from '../mcp/servers';

// Import LLM adapters to ensure they're registered
import '../llm/openAiAdapter';
import '../llm/ollamaAdapter';
import '../llm/anthropicAdapter';

/**
 * Set up signal handlers for clean shutdown
 */
function setupSignalHandlers(mcpRegistry: any, agent: AgentController): void {
  const cleanup = async (): Promise<void> => {
    console.log(chalk.yellow('\nShutting down boom2...'));
    try {
      // Close the agent (which will close the logger)
      agent.close();

      // Stop all MCP servers
      await mcpRegistry.stopAllServers();

      console.log(chalk.green('Shutdown complete. Goodbye!'));
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Error during shutdown:'), error);
      process.exit(1);
    }
  };

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', cleanup);

  // Handle SIGTERM
  process.on('SIGTERM', cleanup);
}

/**
 * Start an interactive prompt for user input
 */
function startInteractivePrompt(agent: AgentController): void {
  const promptUser = (): void => {
    inquirer
      .prompt([
        {
          type: 'input',
          name: 'query',
          message: '>',
        },
      ])
      .then(async (answers) => {
        const { query } = answers;
        if (query.trim() === '') {
          promptUser();
          return;
        }

        // Process the user's input
        await agent.processUserInput(query);

        // Prompt again for the next query
        promptUser();
      })
      .catch((error) => {
        console.error(chalk.red('Error processing input:'), error);
        promptUser();
      });
  };

  // Start the first prompt
  promptUser();
}

/**
 * Initialize a new configuration file
 */
async function initConfig(): Promise<void> {
  console.log(chalk.blue('Initializing boom2 configuration...'));

  // Check if config file already exists
  const configPath = path.join(process.cwd(), '.boom2.json');
  if (fs.existsSync(configPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Configuration file already exists. Overwrite?',
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.yellow('Configuration creation cancelled.'));
      return;
    }
  }

  // Ask for LLM provider
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select an LLM provider:',
      choices: ['openai', 'anthropic', 'ollama'],
    },
  ]);

  // Ask for API key if needed
  let apiKey = '';
  if (provider !== 'ollama') {
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: `Enter your ${provider} API key:`,
      },
    ]);
    apiKey = key;
  }

  // Ask for model based on provider
  let defaultModel = 'llama2';
  if (provider === 'openai') {
    defaultModel = 'gpt-4';
  } else if (provider === 'anthropic') {
    defaultModel = 'claude-2';
  }

  const { model } = await inquirer.prompt([
    {
      type: 'input',
      name: 'model',
      message: `Enter the model to use (default: ${defaultModel}):`,
      default: defaultModel,
    },
  ]);

  // Create config
  const config = {
    llm: {
      provider,
      apiKey,
      model,
    },
    mcpServers: {
      memory: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: {
          DATA_PATH: '.boom2/memory-graph.json',
        },
      },
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/node/project'],
      },
    },
    verbose: false,
  };

  // Save config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(chalk.green(`Configuration saved to ${configPath}`));
}

/**
 * Start the boom2 agent
 */
async function startAgent(options: { verbose?: boolean; logs?: boolean }): Promise<void> {
  try {
    console.log(chalk.blue('Starting boom2 agent...'));

    // Load configuration
    const config = await loadConfig();

    // Create .boom2 directory if it doesn't exist (for logs and memory)
    const boom2Dir = path.join(process.cwd(), '.boom2');
    if (!fs.existsSync(boom2Dir)) {
      fs.mkdirSync(boom2Dir, { recursive: true });
    }

    // Determine if logs should be saved to files
    const saveLogsToFile = options.verbose && options.logs !== false;
    if (options.verbose) {
      if (saveLogsToFile) {
        console.log(chalk.blue('Verbose mode enabled with file logging'));
        // Ensure logs directory exists
        const logsDir = path.join(boom2Dir, 'logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
      } else {
        console.log(chalk.blue('Verbose mode enabled (without file logging)'));
      }
    }

    // Start MCP servers
    const mcpRegistry = await startMcpServers(config.mcpServers);

    // Create an agent controller
    const agent = new AgentController({
      llmConfig: config.llm,
      mcpRegistry,
      verbose: !!options.verbose,
      saveLogsToFile,
    });

    // Set up signal handling for clean shutdown
    setupSignalHandlers(mcpRegistry, agent);

    console.log(chalk.green('boom2 agent is ready!'));
    console.log(chalk.blue('Type your requests below or use Ctrl+C to exit'));

    // Start interactive prompt
    startInteractivePrompt(agent);
  } catch (error) {
    console.error(chalk.red('Error starting boom2 agent:'), error);
    process.exit(1);
  }
}

/**
 * Entry point for the boom2 CLI tool
 */
async function main(): Promise<void> {
  // Setup CLI
  const program = new Command();

  program
    .name('boom2')
    .description('boom2 - LLM-based programming agent')
    .version('0.1.0');

  // Add subcommands
  program
    .command('init')
    .description('Initialize boom2 with a new configuration file')
    .action(initConfig);

  program
    .command('start')
    .description('Start the boom2 agent')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--no-logs', 'Disable saving logs to files (even in verbose mode)')
    .action(startAgent);

  // Parse arguments
  program.parse(process.argv);

  // If no command is provided, show help
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

// Execute the main function
main().catch((error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});
