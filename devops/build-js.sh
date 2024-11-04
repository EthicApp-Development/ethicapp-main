#!/bin/bash -exu

cd "$(dirname "$0")/../ethicapp/frontend/assets/js"

esbuild common-ethicapp-deps.js --bundle --outfile=assets-bundle.js --minify --watch=forever
