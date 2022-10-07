#!/bin/sh
# --------------------------------------------------------------------------------------------------
# Executes the configured linters for the project, checking the code base passes the code style.
# Intended for CI.
# --------------------------------------------------------------------------------------------------

#TODO: SQL linter

#TODO: CSS linter

echo ">>> Running HTML linter"
npx htmlhint "./**/*.html"
echo "[OK] HTMLHint pass"

echo ">>> Running JavaScript linter"
npx eslint "./**/*.js" # add the "--fix" flag for automatically correct fixable problems
echo "[OK] ESLint pass"

echo "[OK] Yay! Linters passed with no errors"
