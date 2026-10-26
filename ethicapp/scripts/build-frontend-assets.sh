#!/bin/sh
set -eu

# Production assets carry no source maps (#187); the development watcher
# (watch-frontend-assets.sh) keeps them. Identifiers are not minified:
# some AngularJS registrations still rely on implicit injection by
# parameter name.
build_esbuild() {
  entry="$1"
  outfile="$2"

  echo "Building $entry..."
  npx esbuild "$entry" --bundle --minify-whitespace --minify-syntax --outfile="$outfile"
}

cd /app/frontend/assets/js/modules/teacher
build_esbuild teacher-admin.mjs ../../dist/teacher-admin.min.js

cd /app/frontend/assets/css
echo "Building styles.scss..."
npx sass --style=compressed --no-source-map styles.scss:dist/assets-bundle.css
if grep -q "node_modules" dist/assets-bundle.css; then
  echo "ERROR: assets-bundle.css must not reference node_modules paths." >&2
  exit 1
fi

cd /app/frontend/assets/js
build_esbuild common-ethicapp-deps.js dist/common-ethicapp-deps.min.js

echo "EthicApp production frontend assets built."
