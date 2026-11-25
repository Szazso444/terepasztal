#!/bin/bash
# Every session: turn on the repository's git hooks, so .githooks/pre-push keeps agents from
# pushing to main or develop. Hosted sessions also install dependencies so the gate can run
# straight away; local sessions install their own.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
git config core.hooksPath .githooks

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# npm install, not npm ci: the container image is cached after the hook, and a
# warm node_modules makes the install a no-op on the next session.
npm install --no-audit --no-fund
