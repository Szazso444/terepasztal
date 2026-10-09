#!/bin/bash
# Codex session start: turn on the repository's git hooks (.githooks/pre-push keeps agents from
# pushing to main or develop) and install dependencies when they are missing.
set -euo pipefail

cd "$(dirname "$0")/../.."
git config core.hooksPath .githooks

if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
