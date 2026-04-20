#!/bin/sh

# Exit on errors
set -e

# Print output as commands execute (for debugging)
# set -x

cd /app/backend

# Install dependencies
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Run EthicApp
echo "Starting EthicApp on port ${PORT:-8501}..."
exec npm start
