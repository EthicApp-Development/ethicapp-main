#!/bin/sh
set -eu

build_esbuild() {
  entry="$1"
  outfile="$2"

  echo "Building $entry..."
  npx esbuild "$entry" --bundle --sourcemap --outfile="$outfile"
}

cd /app/frontend/assets/js/modules/teacher
build_esbuild teacher-admin.mjs ../../dist/teacher-admin.min.js

cd /app/frontend/assets/js/modules/common
build_esbuild user-common.mjs ../../dist/user-common.min.js

cd /app/frontend/assets/css
echo "Building styles.scss..."
npx sass --style=compressed styles.scss:dist/assets-bundle.css
if grep -q "node_modules" dist/assets-bundle.css; then
  echo "ERROR: assets-bundle.css must not reference node_modules paths." >&2
  exit 1
fi

cd /app/frontend/assets/js
build_esbuild common-ethicapp-deps.js dist/common-ethicapp-deps.min.js

echo "EthicApp production frontend assets built."
