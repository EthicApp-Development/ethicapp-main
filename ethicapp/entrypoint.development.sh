#!/bin/bash

# Set bash to exit immediately if any command fails and to print all commands
set -eux

# Define the location of the flag
FLAG_FILE="/home/app/.npm_installed"

# Check if npm install has already been executed
if [ ! -f "$FLAG_FILE" ]; then
    echo "npm install has not been executed previously. Running npm install..."
    npm install -g npm@10.9.0
    npm install
    touch "$FLAG_FILE"
    echo "npm install completed. Flag created at $FLAG_FILE."
else
    echo "npm install has already been executed. Skipping installation."
fi

# Export the JWT_SECRET environment variable from a secret
export JWT_SECRET=$(cat /run/secrets/jwt_token)

# Run the application in debug mode
npm run debug
