#!/bin/bash -exu


#Directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

#Build the teacher module
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js/ngmodules/teacher"
npx esbuild teacher_admin.mjs --bundle --outfile=bundled-teacher-admin.js
npx terser bundled-teacher-admin.js --output bundled-teacher-admin.min.js
rm bundled-teacher-admin.js

#Build CSS
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/css"
sass styles.scss assets-bundle.css

#Build JS
cd "$SCRIPT_DIR/../ethicapp/frontend/assets/js"
esbuild main.js --bundle --outfile=assets-bundle.js --minify

echo "Build completed"

