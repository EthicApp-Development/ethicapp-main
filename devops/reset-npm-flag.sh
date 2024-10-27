#!/bin/bash

# Docker image name
IMAGE_NAME="ethicapp-main-ethicapp"

# Start a container with the image, override the entrypoint, and delete the file
docker run --rm --entrypoint sh "$IMAGE_NAME" -c "rm -f /home/app/.npm_installed"

# Explanation:
# - `--rm`: Automatically removes the container after the command finishes.
# - `--entrypoint sh`: Overrides the container's default entrypoint with `sh`, allowing direct execution of the delete command.
# - `-c "rm -f /home/app/.npm_installed"`: Executes the command to delete the file.
