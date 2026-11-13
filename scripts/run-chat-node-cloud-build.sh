#!/usr/bin/env bash
# PR #276 isolated Node + Vite gates for chat safety; not a production deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm run test:chat:contract
npm run test:chat:reply
npm run test:chat:isolation
# These P0 missing-API-key cases originate in a mixed forum/chat legacy
# test file whose old forum fixtures are now out of date.
node --test --test-name-pattern='missing API key|new failed user messages' tests/forum-chat-blockers.test.mjs
npm run build
