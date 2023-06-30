#!/bin/bash -exu

cd "$(dirname "$0")/../ethicapp/frontend/assets/js"

esbuild main.js --bundle --outfile=assets-bundle.js --minify --watch=forever
