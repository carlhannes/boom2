import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

export interface Boom2Config {
  llm: {
    provider: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  mcpServers?: {
    [key: string]: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
  verbose: boolean;
}

/**
 * Prompts the user for LLM configuration
 */
async function setupLlmConfig() {
  console.log(chalk.cyan('Setting up LLM configuration:'));

  const { provider } = await inquirer.prompt({
    type: 'list',
    name: 'provider',
    message: 'Which LLM provider would you like to use?',
    choices: ['openai', 'ollama', 'anthropic', 'other'],
  });

  const config: any = { provider };

  if (provider === 'openai') {
    const { apiKey, model } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your OpenAI API key:',
        validate: (input) => (input ? true : 'API key is required'),
      },
      {
        type: 'list',
        name: 'model',
        message: 'Choose a model:',
        choices: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      },
    ]);
    config.apiKey = apiKey;
    config.model = model;
  } else if (provider === 'ollama') {
    const { baseUrl, model } = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Enter Ollama API URL:',
        default: 'http://localhost:11434',
      },
      {
        type: 'input',
        name: 'model',
        message: 'Enter model name:',
        default: 'llama2',
      },
    ]);
    config.baseUrl = baseUrl;
    config.model = model;
  } else if (provider === 'anthropic') {
    const { apiKey, model } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your Anthropic API key:',
        validate: (input) => (input ? true : 'API key is required'),
      },
      {
        type: 'list',
        name: 'model',
        message: 'Choose a model:',
        choices: ['claude-2', 'claude-instant-1'],
      },
    ]);
    config.apiKey = apiKey;
    config.model = model;
  } else if (provider === 'other') {
    const { apiKey, model, baseUrl } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your API key (if required):',
      },
      {
        type: 'input',
        name: 'model',
        message: 'Enter model name:',
        validate: (input) => (input ? true : 'Model name is required'),
      },
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Enter API URL:',
        validate: (input) => (input ? true : 'API URL is required'),
      },
    ]);
    config.apiKey = apiKey || undefined;
    config.model = model;
    config.baseUrl = baseUrl;
  }

  return config;
}

/**
 * Sets up default MCP server configuration
 */
function setupDefaultMcpServers() {
  return {
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
  };
}

/**
 * Sets up the configuration for boom2
 * Creates a default config if none exists
 */
export async function setupConfig(configPath: string): Promise<Boom2Config> {
  try {
    // Check if config file exists
    if (fs.existsSync(configPath)) {
      console.log(chalk.gray(`Loading configuration from ${configPath}`));
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    }

    console.log(chalk.yellow('No configuration file found. Let\'s set one up!'));

    // Prompt for LLM configuration
    const llmConfig = await setupLlmConfig();

    // Set up default MCP servers configuration
    const mcpServers = setupDefaultMcpServers();

    // Create the config object
    const config: Boom2Config = {
      llm: llmConfig,
      mcpServers,
      verbose: false,
    };

    // Write the config to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green(`Configuration saved to ${configPath}`));

    // Also create the .boom2 directory if it doesn't exist
    const boom2Dir = path.join(process.cwd(), '.boom2');
    if (!fs.existsSync(boom2Dir)) {
      fs.mkdirSync(boom2Dir);
    }

    return config;
  } catch (error) {
    console.error(chalk.red('Error setting up configuration:'), error);
    throw error;
  }
}
