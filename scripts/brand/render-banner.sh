#!/usr/bin/env bash
# Renders docs/brand/banner.html to docs/brand/banner.png (#332).
# Usage: bash scripts/brand/render-banner.sh [path-to-chrome-headless-shell]
# Needs the classic headless browser (chrome-headless-shell, or Chromium's headless_shell): its
# window size is the page size. Desktop Chrome's new headless mode counts browser chrome in the
# window and cuts the bottom off. `npx @puppeteer/browsers install chrome-headless-shell` gets one.
set -euo pipefail
cd "$(dirname "$0")/../.."
CHROME="${1:-$(command -v chrome-headless-shell || command -v headless_shell || echo chrome-headless-shell)}"
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,560 \
  --screenshot="$PWD/docs/brand/banner.png" "file://$PWD/docs/brand/banner.html"
