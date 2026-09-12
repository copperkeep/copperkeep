#!/usr/bin/env bash
# Fails the build on an unexpected outbound URL in the frontend bundle.
#
# Egress is permitted for infrastructure — the box pulls images and renews certificates.
# The application is a different matter: it must not quietly acquire a Google Fonts
# import or an analytics beacon. Under COEP require-corp such a subresource fails
# *silently* in the browser, which is what moves this from hygiene to load-bearing.
set -euo pipefail

DIST="${1:-apps/web/dist}"

if [ ! -d "$DIST" ]; then
  echo "no bundle at $DIST — build first"
  exit 1
fi

# Hosts a built bundle may legitimately mention. Keep this list empty if you can.
ALLOWED='(schema\.org|www\.w3\.org|localhost|127\.0\.0\.1)'

hits="$(grep -rhoE 'https?://[a-zA-Z0-9._-]+' "$DIST" \
  --include='*.js' --include='*.css' --include='*.html' --include='*.json' \
  | sort -u | grep -vE "https?://${ALLOWED}" || true)"

if [ -n "$hits" ]; then
  echo "External URLs found in the bundle:"
  echo "$hits" | sed 's/^/  /'
  echo
  echo "Everything the application needs ships inside the image. Vendor it, or add the"
  echo "host to ALLOWED in this script with a reason."
  exit 1
fi

echo "ok — no external URLs in $DIST"
