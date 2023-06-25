#!/bin/bash

cd ~/ethicapp-main/ethicapp/frontend/assets/js

esbuild main.js --bundle --outfile=ethicapp-external.js --minify --watch
