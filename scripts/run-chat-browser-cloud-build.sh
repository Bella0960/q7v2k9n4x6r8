#!/usr/bin/env bash
# CI-only: run real Chromium browser regression on an unprivileged Ubuntu builder.
# Do not run this against a deployed Worker or a production database.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm run build
npx playwright install chromium
if ! command -v dpkg-deb >/dev/null || ! command -v apt-get >/dev/null; then
  echo "FAIL: Ubuntu apt-get and dpkg-deb are required for unprivileged browser library extraction."
  exit 1
fi
LIB_DIR="$(mktemp -d -t maomao-chromium-libs-XXXXXXXX)"
trap 'rm -rf "$LIB_DIR"' EXIT
(
  cd "$LIB_DIR"
  # Ubuntu Noble package names; apt-get download is unprivileged and never changes system state.
  apt-get download \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    libasound2t64 \
    libatspi2.0-0t64
  for package in ./*.deb; do
    dpkg-deb -x "$package" "$LIB_DIR"
  done
)
export LD_LIBRARY_PATH="$LIB_DIR/usr/lib/x86_64-linux-gnu:$LIB_DIR/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
CHROME_BINARY="$(find "$HOME/.cache/ms-playwright" -name chrome-headless-shell -type f -print -quit)"
if [ -n "$CHROME_BINARY" ]; then
  echo "Chromium remaining missing libraries (if any):"
  ldd "$CHROME_BINARY" | grep 'not found' || true
fi
node tests/chat-reply-bubbles-browser.mjs
