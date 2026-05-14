#!/bin/sh
set -e

echo "Writing student frontend runtime config..."
node scripts/write-runtime-config.mjs

exec "$@"
