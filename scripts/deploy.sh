#!/usr/bin/env bash
# Safe deploy: refuses dirty trees, runs tests, stamps a unique service-worker VERSION
# (so every phone swaps ALL app files together on its next open), deploys, then restores sw.js.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then echo "Commit or stash changes first (deploys must match a commit)."; exit 1; fi
npm test
REV="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
trap 'git checkout -- app/sw.js' EXIT
sed -i '' "s/^const VERSION = '.*';/const VERSION = 'halves-shell-$REV';/" app/sw.js
grep -q "halves-shell-$REV" app/sw.js
npx wrangler deploy
echo "Deployed $REV"
