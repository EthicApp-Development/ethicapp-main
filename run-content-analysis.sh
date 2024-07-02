#!/bin/bash

# Load environment variables from a .env file if it exists.
if [ -f .env ]; then
  set -a
  . .env
  set +a
fi

# See that ETHICAPP_PROJECT_NAME is defined
if [ -z "$ETHICAPP_PROJECT_NAME" ]; then
  echo "The ETHICAPP_PROJECT_NAME environment variable is undefined."
  exit 1
fi

# Check the value of INCLUDE_NGINX and run docker-compose with the necessary files
if [ "$INCLUDE_NGINX" = "true" ]; then
  docker-compose -p "$ETHICAPP_PROJECT_NAME" -f docker-compose.content-analysis.yml -f docker-compose.nginx.yml up
else
  docker-compose -p "$ETHICAPP_PROJECT_NAME" -f docker-compose.content-analysis.yml up
fi