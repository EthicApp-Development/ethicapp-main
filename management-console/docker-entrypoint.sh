#!/bin/sh
set -e

echo "Writing management console frontend runtime config..."
node scripts/write-runtime-config.mjs

if [ "${MNG_PROCESS_ROLE:-web}" = "student-anonymization" ]; then
  echo "Starting management-console student anonymization job..."
  echo "NODE_ENV=${NODE_ENV}"
  exec node backend/scripts/anonymize-students.js
fi

exec "$@"
