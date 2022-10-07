#!/bin/sh
# --------------------------------------------------------------------------------------------------
# Executes the configured linters for the project, checking the code base passes the code style.
# Intended for CI.
# --------------------------------------------------------------------------------------------------

set -eu

echo ">>> Running SQL linter"
sqlfluff lint ./db_config/ --dialect postgres
echo "[OK] SQLFluff pass"

# Run the following for auto-fixing linting violations (in case you don't want to do it with vscode)
#    sqlfluff fix ./db_config/ --dialect postgres # --force

echo ">>> Running CSS linter"
exit 1 #TODO
echo "[OK] StyleLint pass"

echo ">>> Running HTML linter"
npx htmlhint "./**/*.html"
echo "[OK] HTMLHint pass"

echo ">>> Running JavaScript linter"
npx eslint "./**/*.js" # add the "--fix" flag for automatically correct fixable problems
echo "[OK] ESLint pass"

echo "[OK] Yay! Linters passed with no errors"
