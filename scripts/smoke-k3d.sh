#!/usr/bin/env bash
# Installs the chart into a throwaway k3d cluster and runs the same assertions the
# Compose path runs.
#
# Traffic goes through the chart's OWN Ingress, not a proxy this script invents. That
# distinction matters: an earlier version front-ended the services with its own nginx
# whose trailing-slash proxy_pass silently stripped path prefixes, so the chart's Ingress
# was never exercised and shipped broken — /content 404'd for anyone who used it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="copperkeep-smoke"
NAMESPACE="copperkeep"
ADMIN_PASSWORD="smoke-admin-password"
# Host port -> the cluster's load balancer. `localhost` is also the Ingress host, so the
# assertions need no Host header: Traefik's Host() matcher ignores the port.
PORT=18080

cleanup() {
  kubectl -n "$NAMESPACE" logs -l app.kubernetes.io/component=api --tail=80 2>/dev/null || true
  kubectl -n "$NAMESPACE" get pods 2>/dev/null || true
  kubectl -n "$NAMESPACE" get events --sort-by=.lastTimestamp 2>/dev/null | tail -30 || true
  k3d cluster delete "$CLUSTER" || true
}
trap cleanup EXIT

k3d cluster create "$CLUSTER" --port "${PORT}:80@loadbalancer" --wait

# The chart names each image after its service. content-base is what this repo builds;
# the curriculum repo publishes the shipping `content` image FROM it. runtimes stands in
# as the same base rather than being built: the real image downloads ~200MB of Pyodide.
docker tag copperkeep/content-base:ci copperkeep/content:ci
docker tag copperkeep/content-base:ci copperkeep/runtimes:ci
k3d image import -c "$CLUSTER" \
  copperkeep/api:ci copperkeep/web:ci copperkeep/content:ci copperkeep/runtimes:ci

helm install copperkeep "$ROOT/deploy/helm/copperkeep" \
  --namespace "$NAMESPACE" --create-namespace \
  --values "$ROOT/deploy/helm/copperkeep/tests/values-embedded.yaml" \
  --set image.registry=docker.io \
  --set image.repository=copperkeep \
  --set image.tag=ci \
  --set image.pullPolicy=Never \
  --set content.tag=ci \
  --set api.bootstrap.adminPassword="$ADMIN_PASSWORD" \
  --set audio.enabled=false \
  `# The chart's own Ingress is the thing under test.` \
  --set ingress.enabled=true \
  --set ingress.className=traefik \
  --set ingress.host=localhost \
  --set ingress.tls.enabled=false \
  --set api.cookieSecure=false \
  `# k3d's local-path class binds WaitForFirstConsumer, so a backup PVC nothing mounts` \
  `# would stay Pending and fail --wait. Nothing to back up in a 90-second cluster.` \
  --set postgres.backup.enabled=false \
  --wait --timeout 10m

"$ROOT/scripts/smoke-assert.sh" "http://localhost:${PORT}" "$ADMIN_PASSWORD"
