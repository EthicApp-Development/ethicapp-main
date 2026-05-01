#!/bin/bash -exu

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Function to run esbuild in watch mode for a specific module
watch_esbuild() {
    local entry="$1"
    local outdir="$2"
    echo "Watching $entry for changes..."
    npx esbuild "$entry" --bundle --sourcemap --outdir="$outdir" --watch=forever &
    PIDS+=($!) # Store the PID of the background process
}

# Function to handle SIGINT (Ctrl+C)
cleanup() {
    echo "Aborting script and killing background processes..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null
    done
    exit 0
}

# Capture SIGINT
trap cleanup SIGINT

# Array to store the PIDs of background processes
PIDS=()

# Teacher App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/teacher"
watch_esbuild "teacher-admin.mjs" "../../dist"

# UserCommon App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/common"
watch_esbuild "user-common.mjs" "../../dist"

# CSS dependencies (SASS Watch)
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/css"
sass --watch styles.scss:dist/assets-bundle.css &
PIDS+=($!) # Store the PID of the background process

# Common JS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js"
watch_esbuild "common-ethicapp-deps.js" "dist"

echo "Watching files for changes..."
wait # Wait for all background processes to finish
