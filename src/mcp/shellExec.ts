import { createServer } from 'http';
import { exec } from 'child_process';
import { AddressInfo } from 'net';
import chalk from 'chalk';

/**
 * A minimal MCP server for executing shell commands
 */
class ShellExecServer {
  private server: any;

  private port = 0;

  /**
   * Starts the shell execution MCP server
   */
  async start(): Promise<string> {
    return new Promise((resolve) => {
      // Create HTTP server
      this.server = createServer((req, res) => {
        // Handle different routes
        if (req.method === 'GET' && req.url === '/tools') {
          ShellExecServer.handleTools(req, res);
        } else if (req.method === 'POST' && req.url === '/invoke') {
          ShellExecServer.handleInvoke(req, res);
        } else {
          // Handle unknown routes
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });

      // Start listening on a random port
      this.server.listen(0, () => {
        const address = this.server.address() as AddressInfo;
        this.port = address.port;
        const serverUrl = `http://localhost:${this.port}`;
        console.log(chalk.gray(`Shell execution MCP server running at ${serverUrl}`));
        resolve(serverUrl);
      });
    });
  }

  /**
   * Stops the server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      console.log(chalk.gray('Shell execution MCP server stopped'));
    }
  }

  /**
   * Handles the GET /tools endpoint
   */
  private static handleTools(req: any, res: any): void {
    // Define the shell execution tool
    const tools = [
      {
        name: 'executeShellCommand',
        description: 'Executes a shell command and returns the output',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute',
            },
          },
          required: ['command'],
        },
      },
    ];

    // Respond with available tools
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools }));
  }

  /**
   * Handles the POST /invoke endpoint
   */
  private static handleInvoke(req: any, res: any): void {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        // Check if we're trying to execute a shell command
        if (data.tool === 'executeShellCommand') {
          ShellExecServer.executeShellCommand(data.arguments.command, res);
        } else {
          // Unknown tool
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown tool' }));
        }
      } catch (error) {
        // Handle JSON parsing errors
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  }

  /**
   * Executes a shell command and returns the result
   */
  private static executeShellCommand(command: string, res: any): void {
    console.log(chalk.yellow(`Executing shell command: ${command}`));

    exec(command, (error, stdout, stderr) => {
      let result;
      if (error) {
        // Command execution failed
        result = {
          exitCode: error.code,
          stdout,
          stderr,
          error: error.message,
        };
        console.error(chalk.red(`Command execution failed: ${error.message}`));
      } else {
        // Command executed successfully
        result = {
          exitCode: 0,
          stdout,
          stderr,
        };
        console.log(chalk.green('Command executed successfully'));
      }

      // Return the result
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  }
}

// Export the class as default export to fix the ESLint warning
export default ShellExecServer;
