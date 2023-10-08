# Use an official Node.js runtime as the base image
FROM node:14-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the React app's source code to the container
COPY . .

# Build the React app
RUN npm run build

# Install the 'serve' package globally
RUN npm install -g serve

# Expose port 5000 (or the port that serve will use)
EXPOSE 3000

# Start the 'serve' command to serve the built React app
CMD ["serve", "-s", "build"]
