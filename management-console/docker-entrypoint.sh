#!/bin/sh
set -e

echo "Writing management console frontend runtime config..."
node scripts/write-runtime-config.mjs

exec "$@"
