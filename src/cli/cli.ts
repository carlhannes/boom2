#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { loadConfig, defaultConfig } from './config';
import { AgentController } from '../agent/agentController';
import startMcpServers from '../mcp/servers';

const program = new Command();

/**
 * Entry point for the boom2 CLI tool
 */
async function main() {
  // Setup CLI
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
    .action(startAgent);

  // Parse arguments
  program.parse(process.argv);

  // If no command is provided, show help
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

/**
 * Initialize a new configuration file
 */
async function initConfig() {
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

  // Ask for model if needed
  const defaultModel = provider === 'openai' ? 'gpt-4' : provider === 'anthropic' ? 'claude-2' : 'llama2';
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
    ...defaultConfig,
    llm: {
      provider,
      apiKey,
      model,
    },
  };

  // Save config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(chalk.green(`Configuration saved to ${configPath}`));
}

/**
 * Start the boom2 agent
 */
async function startAgent(options: { verbose?: boolean }) {
  try {
    console.log(chalk.blue('Starting boom2 agent...'));

    // Load configuration
    const config = await loadConfig();

    // Start MCP servers
    const mcpRegistry = await startMcpServers(config.mcpServers);

    // Set up signal handling for clean shutdown
    setupSignalHandlers(mcpRegistry);

    // Create an agent controller
    const agent = new AgentController({
      llmConfig: config.llm,
      mcpRegistry,
      verbose: !!options.verbose,
    });

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
 * Set up signal handlers for clean shutdown
 */
function setupSignalHandlers(mcpRegistry: any) {
  const cleanup = async () => {
    console.log(chalk.yellow('\nShutting down boom2...'));

    try {
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
function startInteractivePrompt(agent: AgentController) {
  const promptUser = () => {
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

// Execute the main function
main().catch((error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});
