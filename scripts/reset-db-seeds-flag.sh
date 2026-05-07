#!/bin/bash

# Load the PostgreSQL version from the environment variable
POSTGRES_VERSION="${POSTGRES_VERSION:-17}"

# Define the image name using the version from the environment variable
IMAGE_NAME="postgres:${POSTGRES_VERSION}"

# Run the container with the specified PostgreSQL image and delete the flag file
docker run --rm --entrypoint sh "$IMAGE_NAME" -c "rm -f /var/lib/postgresql/data/seeds_executed.flag"

# Explanation:
# - `--rm`: Automatically removes the container after the command finishes.
# - `--entrypoint sh`: Overrides the default entrypoint with `sh`, allowing direct execution of the delete command.
# - `-c "rm -f /var/lib/postgresql/data/seeds_executed.flag"`: Executes the delete command inside the container.
