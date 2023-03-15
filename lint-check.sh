#!/bin/sh -eu
# --------------------------------------------------------------------------------------------------
# Executes the configured linters for the project, checking the code base passes the code style.
# Intended for CI. This script exits with code 0 only when all linters pass. The commented lines
# below allow to automatically fix lint rule violations whenever possible (remember you could do
# this in your vscode due the project IDE settings).
# --------------------------------------------------------------------------------------------------

echo ">>> Running SQL linter"
sqlfluff lint ./db_config/
# sqlfluff fix ... --force
echo "[OK] SQLFluff pass"

echo ">>> Running CSS linter"
npx stylelint public/css/*.css
# npx stylelint --fix ...
echo "[OK] StyleLint pass"

echo ">>> Running HTML linter"
npx htmlhint "public/**/*.html"
echo "[OK] HTMLHint pass"

echo ">>> Running JavaScript linter"
npx eslint "./**/*.js" "./bin/www" # --fix
echo "[OK] ESLint pass"

echo "[OK] Yay! Linters passed with no errors"
