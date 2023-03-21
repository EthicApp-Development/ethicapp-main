#!/bin/bash
# --------------------------------------------------------------------------------------------------
# Sets the database connection string for the Node module and other values.
# --------------------------------------------------------------------------------------------------

source .env

echo "module.exports.dbcon = \"tcp://$DB_USER_NAME:$DB_USER_PASSWORD@postgres:5432/$DB_NAME\";
module.exports.uploadPath = \"/tmp/foo\";

module.exports.GOOGLE_CLIENT_ID = \"foo.apps.googleusercontent.com\";
module.exports.GOOGLE_CLIENT_SECRET = \"qwerty\";

module.exports.Captcha_Web = \"qwerty\";
module.exports.Captcha_Secret = \"qwerty\";

module.exports.accessKeyId = \"qwerty\";
module.exports.secretAccessKey = \"qwerty\";
" > ./ethicapp-node/modules/passwords.js
