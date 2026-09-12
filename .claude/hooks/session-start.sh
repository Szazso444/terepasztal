#!/bin/bash
# Installs dependencies so a Claude Code on the web session can typecheck, lint,
# test and build straight away. Local sessions install their own.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install, not npm ci: the container image is cached after the hook, and a
# warm node_modules makes the install a no-op on the next session.
npm install --no-audit --no-fund
