#!/usr/bin/env bash
# Stands up the Compose stack and runs scripts/smoke-assert.sh against it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/deploy/compose"

ADMIN_PASSWORD="smoke-admin-password"

cat > .env <<EOF
POSTGRES_PASSWORD=smoke-postgres-password
COPPERKEEP_SESSION_SECRET=smoke-session-secret-that-is-long-enough
COPPERKEEP_ADMIN_TOKEN=smoke-admin-token
COPPERKEEP_BOOTSTRAP_ADMIN_USERNAME=admin
COPPERKEEP_BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}
COPPERKEEP_HTTP_PORT=8443
COPPERKEEP_COOKIE_SECURE=false
EOF

# The images this commit would ship, plus a stand-in for audio (nothing here plays a
# sound, and the image ships empty until a Piper voice is vendored).
#
# content and runtimes are NOT stubbed. The published curriculum image is used so there
# are real lessons to walk, and real Pyodide to run them with. Substituting placeholders
# for either is exactly the stand-in habit that let five bugs through: the empty
# content-base manifest declares zero courses, so the app has nothing to render and every
# lesson test times out against a page that is working perfectly.
cat > docker-compose.override.yml <<'EOF'
services:
  api:
    image: copperkeep/api:ci
  migrate:
    image: copperkeep/api:ci
  web:
    image: copperkeep/web:ci
  audio:
    image: nginx:1.27-alpine
  runtimes:
    image: copperkeep/runtimes:ci
EOF

cleanup() {
  docker compose logs --no-color --tail=80 api migrate || true
  docker compose down -v --remove-orphans || true
  rm -f docker-compose.override.yml .env
}
trap cleanup EXIT

docker compose up -d
"$ROOT/scripts/smoke-assert.sh" "http://localhost:8443" "$ADMIN_PASSWORD"

# The API-level assertions above cannot see a dead Run button or a lesson that leads
# nowhere. Opt in with COPPERKEEP_E2E=1 so this script stays usable without browsers
# installed.
if [ "${COPPERKEEP_E2E:-0}" = "1" ]; then
  COPPERKEEP_USERNAME=admin COPPERKEEP_PASSWORD="$ADMIN_PASSWORD" \
    "$ROOT/scripts/e2e.sh" "http://localhost:8443"
fi
