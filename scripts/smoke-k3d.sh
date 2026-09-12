#!/usr/bin/env bash
# Installs the chart into a throwaway k3d cluster and runs the same assertions the
# Compose path runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="copperkeep-smoke"
NAMESPACE="copperkeep"
ADMIN_PASSWORD="smoke-admin-password"

cleanup() {
  kubectl -n "$NAMESPACE" logs -l app.kubernetes.io/component=api --tail=80 2>/dev/null || true
  kubectl -n "$NAMESPACE" get pods 2>/dev/null || true
  k3d cluster delete "$CLUSTER" || true
}
trap cleanup EXIT

k3d cluster create "$CLUSTER" --wait

# The chart names the image after the service. content-base is what this repo builds;
# the curriculum repo publishes the shipping `content` image FROM it.
docker tag copperkeep/content-base:ci copperkeep/content:ci
k3d image import -c "$CLUSTER" \
  copperkeep/api:ci copperkeep/web:ci copperkeep/content:ci

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
  --set ingress.enabled=false \
  --set ingress.tls.enabled=false \
  --wait --timeout 10m

# No ingress in the smoke cluster: the assertions need one origin, so nginx in the web
# pod would not route /v1. Port-forward the pieces and front them with the same proxy
# config Compose uses.
kubectl -n "$NAMESPACE" port-forward svc/copperkeep-copperkeep-web 18080:8080 &
kubectl -n "$NAMESPACE" port-forward svc/copperkeep-copperkeep-api 18000:8000 &
kubectl -n "$NAMESPACE" port-forward svc/copperkeep-copperkeep-content 18081:8080 &
sleep 5

docker run -d --name copperkeep-smoke-proxy --network host \
  -v "$ROOT/scripts/smoke-proxy.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.27-alpine
trap 'docker rm -f copperkeep-smoke-proxy >/dev/null 2>&1 || true; cleanup' EXIT
sleep 3

"$ROOT/scripts/smoke-assert.sh" "http://localhost:18443" "$ADMIN_PASSWORD"
