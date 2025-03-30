FROM node:20-slim

# Install Python and other necessary tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install MCP servers globally
RUN npm install -g @modelcontextprotocol/server-memory @modelcontextprotocol/server-filesystem && \
    # Show the installed binaries for debugging
    ls -la /usr/local/bin/

# Copy source code and build
COPY . .
RUN npm run build

# Set working directory for mounted project
WORKDIR /home/node/project

# Create directory for boom2 data
RUN mkdir -p /app/.boom2

# Set environment variables
ENV NODE_ENV=production
# Force MCP servers to use HTTP transport
ENV MCP_TRANSPORT=http
ENV MCP_HOST=0.0.0.0

# Set entrypoint
ENTRYPOINT ["node", "/app/bin/boom2.js"]