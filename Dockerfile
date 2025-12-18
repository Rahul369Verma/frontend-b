# Start from Node base image
FROM node:22-slim

# Set working dir
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose Vite Port
EXPOSE 5173

# Start Dev Server (Host 0.0.0.0 is needed for Docker)
CMD ["npm", "run", "dev", "--", "--host"]
