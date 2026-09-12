#!/usr/bin/env bash
# Renders the chart for every Postgres mode and each tutor state, and diffs the result
# against committed golden files.
#
# The value is not the rendering — it is that an unintended manifest change arrives in a
# pull request as a reviewable diff rather than as a surprise in a cluster.
#
# UPDATE_GOLDEN=1 scripts/helm-golden.sh   # accept the new output
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHART="$ROOT/deploy/helm/copperkeep"
GOLDEN="$CHART/tests/golden"
mkdir -p "$GOLDEN"

status=0
for values in "$CHART"/tests/values-*.yaml; do
  name="$(basename "$values" .yaml)"
  name="${name#values-}"
  rendered="$(mktemp)"

  helm template copperkeep "$CHART" \
    --namespace copperkeep \
    --values "$values" \
    > "$rendered"

  golden="$GOLDEN/$name.yaml"
  if [ "${UPDATE_GOLDEN:-0}" = "1" ] || [ ! -f "$golden" ]; then
    cp "$rendered" "$golden"
    if [ "${UPDATE_GOLDEN:-0}" != "1" ]; then
      echo "created $golden — review and commit it"
      status=1
    else
      echo "updated $golden"
    fi
  elif diff -u "$golden" "$rendered" > /dev/null; then
    echo "ok       $name"
  else
    echo "CHANGED  $name"
    diff -u "$golden" "$rendered" || true
    status=1
  fi
  rm -f "$rendered"
done

exit "$status"
