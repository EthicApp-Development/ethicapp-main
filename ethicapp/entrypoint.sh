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

  dependency_state_file="node_modules/.npm_dependency_state"
  current_dependency_state="$(
    {
      sha256sum package.json
      if [ -f package-lock.json ]; then
        sha256sum package-lock.json
      fi
    } | sha256sum | cut -d ' ' -f 1
  )"
  installed_dependency_state=""

  if [ -f "$dependency_state_file" ]; then
    installed_dependency_state="$(cat "$dependency_state_file")"
  fi

  if [ ! -d "$dependency_path" ] || [ "$installed_dependency_state" != "$current_dependency_state" ]; then
    echo "Installing dependencies in $directory..."
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
    mkdir -p node_modules
    echo "$current_dependency_state" > "$dependency_state_file"
  fi
}

start_asset_watcher() {
  echo "Starting EthicApp frontend asset watcher..."
  /app/scripts/watch-frontend-assets.sh &
  WATCH_PIDS="$WATCH_PIDS $!"
}

seed_canonical_activities() {
  if [ "${ETHICAPP_SEED_CANONICAL_ACTIVITIES:-true}" != "true" ]; then
    echo "Canonical activity seed disabled."
    return 0
  fi

  if [ ! -f /database/seeds/canonical-activities/manifest.json ]; then
    echo "Canonical activity seed manifest not found. Skipping seed."
    return 0
  fi

  echo "Seeding canonical activities..."

  attempts=1
  max_attempts="${ETHICAPP_SEED_CANONICAL_ACTIVITIES_ATTEMPTS:-12}"

  while [ "$attempts" -le "$max_attempts" ]; do
    if npm run seed:canonical-activities; then
      echo "Canonical activity seed completed."
      return 0
    fi

    echo "Canonical activity seed attempt $attempts/$max_attempts failed."
    attempts=$((attempts + 1))
    sleep 5
  done

  echo "Canonical activity seed could not be completed after $max_attempts attempts. Continuing startup."
}

install_dependencies /app/backend node_modules/dotenv

if [ "${ETHICAPP_PROCESS_ROLE:-web}" = "pdf-render-worker" ]; then
  cd /app/backend
  echo "Starting EthicApp PDF render worker..."
  echo "NODE_ENV=${NODE_ENV}"
  exec npm run worker:pdf-render
fi

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
  seed_canonical_activities

  echo "Running in development mode with nodemon..."
  trap cleanup EXIT INT TERM
  npx nodemon --inspect=0.0.0.0:9229 --nolazy ./ethicapp &
  APP_PID="$!"
  wait "$APP_PID"
else
  echo "Running in production mode..."
  exec npm start
fi
