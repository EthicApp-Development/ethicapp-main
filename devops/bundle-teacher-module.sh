#!/bin/bash -exu

cd "$(dirname "$0")/../ethicapp/frontend/assets/js/ngmodules/teacher"

npx esbuild teacher_admin.mjs --bundle --outfile=bundled-teacher-admin.js

npx terser bundled-teacher-admin.js --output bundled-teacher-admin.min.js

rm bundled-teacher-admin.js

echo "Bundle and minification completed."
