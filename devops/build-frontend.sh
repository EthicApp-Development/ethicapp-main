#!/bin/bash -exu

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Teacher App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/teacher"
npx esbuild teacher-admin.mjs --bundle --sourcemap --outdir=../../dist
npx terser ../../dist/teacher-admin.js --output ../../dist/teacher-admin.min.js
rm ../../dist/teacher-admin.js

# UserCommon App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/common"
npx esbuild user-common.mjs --bundle --sourcemap --outdir=../../dist
npx terser ../../dist/user-common.js --output ../../dist/user-common.min.js
rm ../../dist/user-common.js

# Students' Sessions App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student"
npx esbuild sessions.mjs --bundle --sourcemap --outdir=../../dist
npx terser ../../dist/sessions.js --output ../../dist/sessions.min.js
rm ../../dist/sessions.js

# StudentEthics App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student"
npx esbuild ethics.mjs --bundle --sourcemap --outdir=../../dist
npx terser ../../dist/ethics.js --output ../../dist/ethics.min.js
rm ../../dist/ethics.js

# RolePlaying App
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/modules/student"
npx esbuild role-playing.mjs --bundle --sourcemap --outdir=../../dist
npx terser ../../dist/role-playing.js --output ../../dist/role-playing.min.js
rm ../../dist/role-playing.js

# Build CSS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/css"
sass styles.scss dist/assets-bundle.css

# Build JS dependencies
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js"
npx esbuild common-ethicapp-deps.js --bundle --outdir=dist
npx terser dist/common-ethicapp-deps.js \
  --output dist/common-ethicapp-deps.min.js \
  --source-map "filename='common-ethicapp-deps.min.js.map',url='common-ethicapp-deps.min.js.map'"
rm dist/common-ethicapp-deps.js

echo "Build complete"
