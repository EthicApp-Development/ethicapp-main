#!/bin/sh
set -e

cd /app/backend

# Install dependencies if missing
if [ ! -d "node_modules/dotenv" ]; then
  echo "Installing dependencies..."
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

echo "Starting EthicApp on port ${PORT:-8501}..."
echo "NODE_ENV=${NODE_ENV}"

# Decide how to run the app
if [ "$NODE_ENV" = "development" ]; then
  echo "Running in development mode with nodemon..."
  exec npx nodemon --inspect=0.0.0.0:9229 --nolazy ./ethicapp
else
  echo "Running in production mode..."
  exec npm start
fi