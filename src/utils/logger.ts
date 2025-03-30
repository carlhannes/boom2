import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Configuration for the logger
 */
export interface LoggerConfig {
  /**
   * Whether to print verbose logs
   */
  verbose: boolean;
  /**
   * Whether to save logs to a file
   */
  saveToFile: boolean;
  /**
   * Directory to save logs in (relative to current working directory)
   */
  logDir?: string;
}

/**
 * Logger utility for boom2
 * Handles both console output and file logging
 */
export class Logger {
  private verbose: boolean;
  private saveToFile: boolean;
  private logFile: string | null = null;
  private logStream: fs.WriteStream | null = null;

  /**
   * Creates a new logger
   */
  constructor(config: LoggerConfig) {
    this.verbose = config.verbose;
    this.saveToFile = config.saveToFile && this.verbose; // Only save to file if verbose is enabled
    
    if (this.saveToFile) {
      this.setupLogFile(config.logDir || '.boom2/logs');
    }
  }

  /**
   * Sets up the log file
   */
  private setupLogFile(logDir: string): void {
    try {
      // Create log directory if it doesn't exist
      const fullLogDir = path.join(process.cwd(), logDir);
      if (!fs.existsSync(fullLogDir)) {
        fs.mkdirSync(fullLogDir, { recursive: true });
      }

      // Create log file with timestamp
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      this.logFile = path.join(fullLogDir, `${timestamp}.log`);
      
      // Create write stream
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      
      // Log the start of the session
      this.info(`Boom2 session started at ${new Date().toLocaleString()}`);
      this.info(`Log file: ${this.logFile}`);
    } catch (error) {
      console.error(chalk.red('Error setting up log file:'), error);
      this.saveToFile = false;
    }
  }

  /**
   * Logs an info message
   */
  info(message: string, data?: any): void {
    console.log(chalk.blue(message));
    if (data) {
      console.log(data);
    }
    this.writeToFile('INFO', message, data);
  }

  /**
   * Logs a success message
   */
  success(message: string, data?: any): void {
    console.log(chalk.green(message));
    if (data) {
      console.log(data);
    }
    this.writeToFile('SUCCESS', message, data);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, data?: any): void {
    console.log(chalk.yellow(message));
    if (data) {
      console.log(data);
    }
    this.writeToFile('WARN', message, data);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: any): void {
    console.error(chalk.red(message));
    if (error) {
      console.error(error);
    }
    this.writeToFile('ERROR', message, error);
  }

  /**
   * Logs a verbose message (only if verbose mode is enabled)
   */
  verbose(message: string, data?: any): void {
    if (!this.verbose) return;
    
    console.log(chalk.gray(message));
    if (data) {
      if (typeof data === 'object') {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data);
      }
    }
    this.writeToFile('VERBOSE', message, data);
  }

  /**
   * Logs a tool execution
   */
  tool(toolName: string, serverName: string, args?: any, result?: any): void {
    console.log(chalk.blue(`\nExecuting tool ${toolName} on ${serverName}...`));
    
    if (this.verbose && args) {
      console.log(chalk.gray('Arguments:'), typeof args === 'object' ? JSON.stringify(args, null, 2) : args);
    }
    
    if (result) {
      let resultStr = '';
      if (typeof result === 'object') {
        resultStr = JSON.stringify(result, null, 2);
      } else {
        resultStr = String(result);
      }
      console.log(chalk.cyan('Result:'), resultStr);
    }
    
    this.writeToFile('TOOL', `Executing tool ${toolName} on ${serverName}`, { args, result });
  }

  /**
   * Writes a log entry to the log file
   */
  private writeToFile(level: string, message: string, data?: any): void {
    if (!this.saveToFile || !this.logStream) return;
    
    try {
      const timestamp = new Date().toISOString();
      let logEntry = `[${timestamp}] [${level}] ${message}`;
      
      if (data) {
        if (typeof data === 'object') {
          logEntry += `\n${JSON.stringify(data, null, 2)}`;
        } else {
          logEntry += `\n${data}`;
        }
      }
      
      this.logStream.write(`${logEntry}\n\n`);
    } catch (error) {
      console.error(chalk.red('Error writing to log file:'), error);
    }
  }

  /**
   * Closes the log file
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

/**
 * Creates a new logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}