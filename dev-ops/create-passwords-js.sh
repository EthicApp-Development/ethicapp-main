#!/bin/bash -eu
# --------------------------------------------------------------------------------------------------
# Sets the database connection string for the Node module and other values (for containerized
# runtime).
# --------------------------------------------------------------------------------------------------

source .env

echo "module.exports.dbcon = \"tcp://$DB_USERNAME:$DB_PASSWORD@postgres:5432/$DB_NAME\";
module.exports.uploadPath = \"frontend/assets/uploads\";

module.exports.GOOGLE_CLIENT_ID = \"foo.apps.googleusercontent.com\";
module.exports.GOOGLE_CLIENT_SECRET = \"qwerty\";

module.exports.RECAPTCHA_SITE_KEY = \"qwerty\";
module.exports.RECAPTCHA_SECRET = \"qwerty\";

module.exports.AWS_APIKEY = \"qwerty\";
module.exports.AWS_SECRET = \"qwerty\";
" > ./ethicapp/backend/config/keys-n-secrets.js
