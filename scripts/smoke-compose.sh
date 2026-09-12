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

# The images this commit would ship, plus stand-ins for the two the curriculum repo
# builds. content-base carries an empty-but-valid manifest, which is enough to exercise
# the API's content dependency and its event validation.
cat > docker-compose.override.yml <<'EOF'
services:
  api:
    image: copperkeep/api:ci
  migrate:
    image: copperkeep/api:ci
  web:
    image: copperkeep/web:ci
  content:
    image: copperkeep/content-base:ci
  audio:
    image: nginx:1.27-alpine
  runtimes:
    image: nginx:1.27-alpine
EOF

cleanup() {
  docker compose logs --no-color --tail=80 api migrate || true
  docker compose down -v --remove-orphans || true
  rm -f docker-compose.override.yml .env
}
trap cleanup EXIT

docker compose up -d
"$ROOT/scripts/smoke-assert.sh" "http://localhost:8443" "$ADMIN_PASSWORD"
