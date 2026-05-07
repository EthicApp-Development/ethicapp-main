#!/bin/sh
set -eu

WATCH_PIDS=""

cleanup() {
  echo "Stopping EthicApp frontend asset watcher..."
  kill $WATCH_PIDS 2>/dev/null || true
}

watch_esbuild() {
  entry="$1"
  outdir="$2"

  echo "Watching $entry..."
  npx esbuild "$entry" --bundle --sourcemap --outdir="$outdir" --watch=forever &
  WATCH_PIDS="$WATCH_PIDS $!"
}

trap cleanup EXIT INT TERM

cd /app/frontend/assets/js/modules/teacher
watch_esbuild teacher-admin.mjs ../../dist

cd /app/frontend/assets/js/modules/common
watch_esbuild user-common.mjs ../../dist

cd /app/frontend/assets/css
echo "Watching styles.scss..."
npx sass --watch styles.scss:dist/assets-bundle.css &
WATCH_PIDS="$WATCH_PIDS $!"

cd /app/frontend/assets/js
watch_esbuild common-ethicapp-deps.js dist

echo "EthicApp frontend asset watcher started."
wait
