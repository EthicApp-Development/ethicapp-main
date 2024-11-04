#!/bin/bash -exu

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Trap para terminar procesos
trap "kill 0" SIGINT SIGTERM EXIT

# Teacher App
concurrently \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/teacher\" && npx esbuild teacher-admin.mjs --bundle --sourcemap --outdir=../../dist --watch" \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/teacher\" && npx wait-on ../../dist/teacher-admin.js && npx terser ../../dist/teacher-admin.js --output ../../dist/teacher-admin.min.js"

# UserCommon App
concurrently \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/common\" && npx esbuild user-common.mjs --bundle --sourcemap --outdir=../../dist --watch" \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/common\" && npx wait-on ../../dist/user-common.js && npx terser ../../dist/user-common.js --output ../../dist/user-common.min.js"

# Students' Sessions App
concurrently \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student\" && npx esbuild sessions.mjs --bundle --sourcemap --outdir=../../dist --watch" \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student\" && npx wait-on ../../dist/sessions.js && npx terser ../../dist/sessions.js --output ../../dist/sessions.min.js"

# StudentEthics App
concurrently \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student\" && npx esbuild ethics.mjs --bundle --sourcemap --outdir=../../dist --watch" \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student\" && npx wait-on ../../dist/ethics.js && npx terser ../../dist/ethics.js --output ../../dist/ethics.min.js"

# RolePlaying App
concurrently \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student\" && npx esbuild role-playing.mjs --bundle --sourcemap --outdir=../../dist --watch" \
  "cd \"$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student\" && npx wait-on ../../dist/role-playing.js && npx terser ../../dist/role-playing.js --output ../../dist/role-playing.min.js"

# CSS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/css"
sass styles.scss dist/assets-bundle.css &

# JS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js"
concurrently \
  "npx esbuild common-ethicapp-deps.js --bundle --outdir=dist --watch" \
  "npx wait-on dist/common-ethicapp-deps.js && npx terser dist/common-ethicapp-deps.js --output dist/common-ethicapp-deps.min.js"

echo "Watching files for changes..."
wait
