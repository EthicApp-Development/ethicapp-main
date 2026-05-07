#!/bin/sh
set -eu

build_esbuild() {
  entry="$1"
  outfile="$2"

  echo "Building $entry..."
  npx esbuild "$entry" --bundle --minify --sourcemap --outfile="$outfile"
}

cd /app/frontend/assets/js/modules/teacher
build_esbuild teacher-admin.mjs ../../dist/teacher-admin.min.js

cd /app/frontend/assets/js/modules/common
build_esbuild user-common.mjs ../../dist/user-common.min.js

cd /app/frontend/assets/css
echo "Building styles.scss..."
npx sass --style=compressed styles.scss:dist/assets-bundle.css

cd /app/frontend/assets/js
build_esbuild common-ethicapp-deps.js dist/common-ethicapp-deps.min.js

echo "EthicApp production frontend assets built."
