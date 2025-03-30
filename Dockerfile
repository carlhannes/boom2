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

# Copy source code and build
COPY . .
RUN npm run build

# Set working directory for mounted project
WORKDIR /home/node/project

# Create directory for boom2 data
RUN mkdir -p /app/.boom2

# Set environment variables
ENV NODE_ENV=production

# Set entrypoint
ENTRYPOINT ["node", "/app/bin/boom2.js"]