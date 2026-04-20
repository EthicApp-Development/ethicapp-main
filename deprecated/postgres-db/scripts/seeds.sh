#!/bin/bash
# This file is intended to be run as the entrypoint within a service
# in a Docker Compose context

FLAG_FILE="/var/lib/postgresql/data/seeds_executed.flag"

# Check whether seeds have been run already
if [ -f "$FLAG_FILE" ]; then
  echo "Seeds have been run already, aborting..."
  exit 0
fi

export PGUSER=${DB_USERNAME}
export PGPASSWORD=${DB_PASSWORD}
export PGDATABASE=${DB_NAME}

# Wait until PostgreSQL is ready
until pg_isready -h postgres; do
  echo "Waiting for PostgreSQL to be ready..."
  sleep 2
done

# Run seeds in order
echo "PostgreSQL is now ready. Running the seeds on the database..."

for file in /seeds/*.sql; do
  echo "Running $file..."
  psql -h postgres -f "$file"
done

# Create the touch file to avoid seeding next time
touch "$FLAG_FILE"

echo "Done seeding the database. You may now shudown docker compose (Ctrl+C)."
