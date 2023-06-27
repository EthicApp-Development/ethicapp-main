#!/bin/bash

cd "$(dirname "$0")/../ethicapp/frontend/assets/js" 

esbuild main.js --bundle --outfile=ethicapp-external.js --minify --watch=forever

