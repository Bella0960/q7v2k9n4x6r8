#!/usr/bin/env bash
# QA-only Chromium browser test in a non-root Cloudflare Builds container.
# Install Ubuntu browser shared libraries into a disposable temp directory;
# never request root, change production bindings, or use live credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_WORK="$(mktemp -d)"
trap 'rm -rf "$LIB_WORK"' EXIT

npx playwright install chromium

mkdir -p "$LIB_WORK/debs" "$LIB_WORK/libs"
(
  cd "$LIB_WORK/debs"
  apt-get download \
    libatk1.0-0t64 libatk-bridge2.0-0t64 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 \
    libasound2t64 libatspi2.0-0t64
  for pkg in ./*.deb; do
    dpkg-deb -x "$pkg" "$LIB_WORK/libs"
  done
)

export LD_LIBRARY_PATH="$LIB_WORK/libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
BROWSER="$(find "$HOME/.cache/ms-playwright" -name chrome-headless-shell -type f | head -n 1)"
if [[ -z "$BROWSER" ]]; then
  echo 'QA Chromium binary missing' >&2
  exit 3
fi
if ldd "$BROWSER" | grep 'not found'; then
  echo 'QA Chromium still has missing shared libraries' >&2
  exit 4
fi

cd "$ROOT"
npm run test:accounts:browser
