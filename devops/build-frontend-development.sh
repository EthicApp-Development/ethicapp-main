#!/bin/bash -exu

# Directorio del script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Teacher App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/teacher"
npx esbuild teacher-admin.mjs --bundle --sourcemap --outdir=../../dist

# UserCommon App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/common"
npx esbuild user-common.mjs --bundle --sourcemap --outdir=../../dist

# Students' Sessions App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student"
npx esbuild sessions.mjs --bundle --sourcemap --outdir=../../dist

# StudentEthics App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student"
npx esbuild ethics.mjs --bundle --sourcemap --outdir=../../dist

# RolePlaying App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student"
npx esbuild role-playing.mjs --bundle --sourcemap --outdir=../../dist

# Build CSS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/css"
sass styles.scss dist/assets-bundle.css

# Build JS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js"
npx esbuild common-ethicapp-deps.js --bundle --sourcemap --outdir=dist

echo "Development build complete"
