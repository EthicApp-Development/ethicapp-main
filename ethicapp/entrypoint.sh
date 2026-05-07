#!/bin/sh
set -e

WATCH_PIDS=""
APP_PID=""

cleanup() {
  echo "Stopping EthicApp development processes..."
  kill $WATCH_PIDS $APP_PID 2>/dev/null || true
}

install_dependencies() {
  directory="$1"
  dependency_path="$2"

  cd "$directory"

  if [ ! -d "$dependency_path" ]; then
    echo "Installing dependencies in $directory..."
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
  fi
}

start_asset_watcher() {
  echo "Starting EthicApp frontend asset watcher..."
  /app/scripts/watch-frontend-assets.sh &
  WATCH_PIDS="$WATCH_PIDS $!"
}

install_dependencies /app/backend node_modules/dotenv

if [ "$NODE_ENV" = "development" ]; then
  install_dependencies /app/frontend node_modules/esbuild

  if [ "${ETHICAPP_WATCH_FRONTEND:-true}" = "true" ]; then
    WATCH_PIDS=""
    start_asset_watcher
  else
    echo "EthicApp frontend asset watcher disabled."
  fi
fi

cd /app/backend

echo "Starting EthicApp on port ${PORT:-8501}..."
echo "NODE_ENV=${NODE_ENV}"

# Decide how to run the app
if [ "$NODE_ENV" = "development" ]; then
  echo "Running in development mode with nodemon..."
  trap cleanup EXIT INT TERM
  npx nodemon --inspect=0.0.0.0:9229 --nolazy ./ethicapp &
  APP_PID="$!"
  wait "$APP_PID"
else
  echo "Running in production mode..."
  exec npm start
fi
