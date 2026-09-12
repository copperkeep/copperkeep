#!/usr/bin/env bash
# Drives a real browser against a running Copperkeep.
#
#   scripts/e2e.sh                                  # the local Compose stack
#   scripts/e2e.sh https://copperkeep.example.com   # a deployed instance
#
# Note that the default target is http://localhost:8443. `localhost` counts as a secure
# context even over plain HTTP, so SharedArrayBuffer is available and interrupt() is
# actually exercised rather than skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export COPPERKEEP_BASE_URL="${1:-${COPPERKEEP_BASE_URL:-http://localhost:8443}}"

echo "browser tests against $COPPERKEEP_BASE_URL"
cd "$ROOT/e2e"
exec pnpm exec playwright test "${@:2}"
