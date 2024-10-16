#!/bin/bash -exu

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Build teacher-side dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/ngmodules/teacher"
npx esbuild teacher_admin.mjs --bundle --outfile=bundled-teacher-admin.js
npx terser bundled-teacher-admin.js --output bundled-teacher-admin.min.js
rm bundled-teacher-admin.js

# Build CSS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/css"
sass styles.scss assets-bundle.css

# Build JS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js"
esbuild main.js --bundle --outfile=assets-bundle.js --minify

echo "Build complete"
