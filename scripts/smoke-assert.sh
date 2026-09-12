#!/usr/bin/env bash
# The smoke test itself. Compose and k3d both call this with a base URL.
#
# Two deployment descriptions of one system diverge quietly. One set of assertions run
# against both is the second defence against that (the first is the shared /config.json
# and environment variable names).
#
# Usage: smoke-assert.sh <base-url> <admin-password>
set -euo pipefail

BASE="${1:?base url required}"
ADMIN_PASSWORD="${2:?admin password required}"

fail() { echo "SMOKE FAILED: $*" >&2; exit 1; }

echo "--- the API is up and considers itself ready"
for _ in $(seq 1 60); do
  curl -fsS "$BASE/healthz" > /dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$BASE/healthz" > /dev/null || fail "healthz never came up"
# Ready means the database answers and the loaded curriculum is compatible.
curl -fsS "$BASE/readyz" | grep -q '"ready":true' \
  || fail "readyz: $(curl -fsS "$BASE/readyz")"

echo "--- the document carries the cross-origin isolation headers"
# The one thing that silently disables interrupt() if a config edit drops it. Cheap to
# assert, and it guards the design's most fragile assumption.
headers="$(curl -fsSI "$BASE/")"
grep -qi 'cross-origin-opener-policy: same-origin' <<<"$headers" \
  || fail "missing Cross-Origin-Opener-Policy — SharedArrayBuffer will be unavailable"
grep -qi 'cross-origin-embedder-policy: require-corp' <<<"$headers" \
  || fail "missing Cross-Origin-Embedder-Policy — SharedArrayBuffer will be unavailable"

echo "--- /config.json is served, and is not baked into the bundle"
curl -fsS "$BASE/config.json" | grep -q '"apiBaseUrl"' || fail "config.json"

echo "--- content is reachable from the browser's origin"
curl -fsS "$BASE/content/manifest.json" | grep -q contentVersion || fail "content manifest"

echo "--- an adult can sign in"
jar="$(mktemp)"
curl -fsS -c "$jar" -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"org\":\"home\",\"username\":\"admin\",\"method\":\"password\",\"secret\":\"${ADMIN_PASSWORD}\"}" \
  | grep -q '"role":"adult"' || fail "adult login"

echo "--- an adult can create a learner"
curl -fsS -b "$jar" -X POST "$BASE/v1/admin/learners" \
  -H 'Content-Type: application/json' \
  -d '{"username":"jada","display_name":"Jada","pin":"1234","reading_tier":"grade3"}' \
  | grep -q learnerId || fail "create learner"

echo "--- the learner can sign in and read a skill map"
learner_jar="$(mktemp)"
curl -fsS -c "$learner_jar" -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"org":"home","username":"jada","method":"pin","secret":"1234"}' \
  | grep -q '"role":"learner"' || fail "learner login"
curl -fsS -b "$learner_jar" "$BASE/v1/skills" > /dev/null || fail "skills"

echo "--- a forged completion for a step that does not exist is rejected"
# Execution is client-side, so mastery claims arrive untrusted. This is the floor of
# what the server must refuse.
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
response="$(curl -fsS -b "$learner_jar" -X POST "$BASE/v1/events" \
  -H 'Content-Type: application/json' \
  -d "{\"events\":[{\"event_type\":\"step_completed\",\"step_id\":\"py.not.a.real.step\",\"occurred_at\":\"${now}\"}]}")"
grep -q '"accepted":0' <<<"$response" || fail "a forged completion was accepted: $response"

echo "--- repeated wrong PINs are throttled"
for _ in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$BASE/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"org":"home","username":"jada","method":"pin","secret":"9999"}'
done
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"org":"home","username":"jada","method":"pin","secret":"9999"}')"
[ "$code" = "429" ] || fail "expected 429 after repeated failures, got $code"

echo
echo "SMOKE PASSED against $BASE"
