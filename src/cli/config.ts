import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { LlmConfig } from '../llm/llmAdapter';

export interface Boom2Config {
  llm: LlmConfig;
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
 * Default configuration for boom2
 */
export const defaultConfig: Partial<Boom2Config> = {
  verbose: false,
  mcpServers: {
    memory: {
      command: 'mcp-server-memory',
      args: [],
      env: {
        DATA_PATH: '.boom2/memory-graph.json',
        MCP_TRANSPORT: 'http',
        MCP_HOST: '0.0.0.0'
      },
    },
    filesystem: {
      command: 'mcp-server-filesystem',
      args: ['/home/node/project'],
      env: {
        MCP_TRANSPORT: 'http',
        MCP_HOST: '0.0.0.0'
      },
    },
  },
};

/**
 * Prompts the user for LLM configuration
 */
async function setupLlmConfig(): Promise<LlmConfig> {
  console.log(chalk.cyan('Setting up LLM configuration:'));
  const { provider } = await inquirer.prompt({
    type: 'list',
    name: 'provider',
    message: 'Which LLM provider would you like to use?',
    choices: ['openai', 'ollama', 'anthropic'],
  });

  // Type assertion to ensure provider is one of the allowed values
  const typedProvider = provider as 'openai' | 'anthropic' | 'ollama';
  const config: LlmConfig = { provider: typedProvider, model: '' };

  if (typedProvider === 'openai') {
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
  } else if (typedProvider === 'ollama') {
    const { baseUrl, model } = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Enter Ollama API URL:',
        default: 'http://host.docker.internal:11434',
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
  } else if (typedProvider === 'anthropic') {
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

/**
 * Load the configuration from the specified path or use default values
 */
export async function loadConfig(configPath?: string): Promise<Boom2Config> {
  const configFile = configPath || path.join(process.cwd(), '.boom2.json');

  try {
    if (fs.existsSync(configFile)) {
      console.log(chalk.gray(`Loading configuration from ${configFile}`));
      const configData = fs.readFileSync(configFile, 'utf8');
      const parsedConfig = JSON.parse(configData);

      // Ensure provider is one of the allowed values
      if (parsedConfig.llm && parsedConfig.llm.provider) {
        const { provider } = parsedConfig.llm;
        if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'ollama') {
          throw new Error(`Invalid LLM provider: ${provider}. Must be one of: openai, anthropic, ollama`);
        }
      }

      return parsedConfig;
    }

    console.log(chalk.yellow('No configuration file found. Setting up a new one...'));
    return await setupConfig(configFile);
  } catch (error) {
    console.error(chalk.red('Error loading configuration:'), error);
    throw error;
  }
}
