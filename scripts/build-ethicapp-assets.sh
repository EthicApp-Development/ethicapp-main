#!/bin/sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

docker run --rm \
  -v "$PROJECT_DIR/ethicapp:/app" \
  -v ethicapp_frontend_asset_node_modules:/app/frontend/node_modules \
  -w /app/frontend \
  node:24 \
  sh -lc '
  cd /app/frontend
  if [ ! -d node_modules/esbuild ]; then
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
  fi
  /app/scripts/build-frontend-assets.sh
'
