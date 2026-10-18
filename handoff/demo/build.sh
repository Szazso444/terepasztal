#!/bin/sh
set -e
OUT=/tmp/claude-0/-home-user-terepasztal/9c22ae5e-5f79-561a-9ba3-d79473b8ce90/scratchpad/demos/codex-art-demo
cd "$(dirname "$0")"
{ cat src/page.html; printf '\n<script>\n'; cat src/world.js; printf '\n'; cat src/app.js; printf '</script>\n'; } > "$OUT/index.html"
node --check src/world.js && node -e "new Function(require('fs').readFileSync('src/app.js','utf8'))" 
wc -c "$OUT/index.html"
