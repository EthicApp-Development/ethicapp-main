#!/bin/bash

cd "$(dirname "$0")/../ethicapp/frontend/assets/css" 

sass --watch styles.scss ethicapp-styles.css