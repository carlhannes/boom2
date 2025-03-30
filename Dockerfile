FROM node:20

# Install Python and other necessary tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install MCP servers both globally and in the node_modules directory
# Global installation for direct command use
# Local installation to enable npx to find them without downloading
RUN npm install -g @modelcontextprotocol/server-memory @modelcontextprotocol/server-filesystem && \
    npm install --no-save @modelcontextprotocol/server-memory @modelcontextprotocol/server-filesystem && \
    echo "Verifying MCP server installations:" && \
    echo "Memory server path:" && which mcp-server-memory && \
    echo "Filesystem server path:" && which mcp-server-filesystem

# Copy source code and build
COPY . .
RUN npm run build

# Set up directories for mounted project and boom2 data
WORKDIR /home/node/project
RUN mkdir -p /app/.boom2

# Set environment variables
ENV NODE_ENV=production

# Set entrypoint
ENTRYPOINT ["node", "/app/bin/boom2.js"]