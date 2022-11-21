#!/bin/sh
# --------------------------------------------------------------------------------------------------
# Executes the configured linters for the project, checking the code base passes the code style.
# Intended for CI. This script exits with code 0 only when all linters pass. The commented lines
# below allow to automatically fix lint rule violations whenever possible (remember you could do
# this in your vscode due the project IDE settings).
# --------------------------------------------------------------------------------------------------

set -eu

echo ">>> Running SQL linter"
sqlfluff lint ./db_config/
# sqlfluff fix ./db_config/ --dialect postgres --force
echo "[OK] SQLFluff pass"

echo ">>> Running CSS linter"
npx stylelint public/css/*.css
# npx stylelint --fix public/css/*.css
echo "[OK] StyleLint pass"

echo ">>> Running HTML linter"
npx htmlhint "public/**/*.html"
npx htmlhint "views/**/*.ejs"
echo "[OK] HTMLHint pass"

echo ">>> Running JavaScript linter"
npx eslint "./**/*.js"
# npx eslint "./**/*.js" --fix
echo "[OK] ESLint pass"

echo "[OK] Yay! Linters passed with no errors"
