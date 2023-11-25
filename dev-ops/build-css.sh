#!/bin/bash -exu

cd "$(dirname "$0")/../ethicapp/frontend/assets/css"

sass --watch styles.scss:assets-bundle.css --style compressed
