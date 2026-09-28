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

echo "--- the origin is up"
for _ in $(seq 1 60); do
  curl -fsS "$BASE/" > /dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$BASE/" > /dev/null || fail "the origin never came up"

echo "--- the API is routed and answering"
# /readyz and /healthz are deliberately NOT public: the chart's Ingress routes /v1 and
# the static prefixes, nothing else. Probes are for the kubelet. An unauthenticated 401
# from a real endpoint is the honest public proof that the API is reachable — readiness
# itself is gated by `helm --wait` and by Compose's healthchecks.
# Retries because this is also the wait: under Compose the proxy answers long before
# the API has migrated and started, so a single shot races and gets a 502.
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/me")"
  [ "$code" = "401" ] && break
  sleep 2
done
[ "$code" = "401" ] || fail "expected 401 from /v1/me, got $code"

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
# First boot creates the admin asynchronously, as soon as migrations land — under Helm
# that is a post-install hook, so it can be a few seconds behind readiness.
jar="$(mktemp)"
for _ in $(seq 1 30); do
  if curl -fsS -c "$jar" -X POST "$BASE/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"org\":\"home\",\"username\":\"admin\",\"method\":\"password\",\"secret\":\"${ADMIN_PASSWORD}\"}" \
      2>/dev/null | grep -q '"role":"adult"'; then
    break
  fi
  sleep 2
done
curl -fsS -c "$jar" -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"org\":\"home\",\"username\":\"admin\",\"method\":\"password\",\"secret\":\"${ADMIN_PASSWORD}\"}" \
  | grep -q '"role":"adult"' || fail "adult login"

echo "--- an adult can create a learner"
created="$(curl -fsS -b "$jar" -X POST "$BASE/v1/admin/learners" \
  -H 'Content-Type: application/json' \
  -d '{"username":"jada","display_name":"Jada","pin":"1234","reading_tier":"grade3"}')"
grep -q learnerId <<<"$created" || fail "create learner"
jada="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["learnerId"])' <<<"$created")"

echo "--- the learner can sign in and read a skill map"
learner_jar="$(mktemp)"
curl -fsS -c "$learner_jar" -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"org":"home","username":"jada","method":"pin","secret":"1234"}' \
  | grep -q '"role":"learner"' || fail "learner login"
curl -fsS -b "$learner_jar" "$BASE/v1/skills" > /dev/null || fail "skills"

echo "--- the bootstrap adult is the org admin, and sees every account"
curl -fsS -b "$jar" "$BASE/v1/me" | grep -q '"is_admin":true' || fail "admin flag on /me"
people="$(curl -fsS -b "$jar" "$BASE/v1/admin/users")"
grep -q '"username":"jada"' <<<"$people" || fail "jada missing from the account list"
grep -q '"username":"admin"' <<<"$people" || fail "admin missing from the account list"

echo "--- an account can be edited, and a username clash is refused"
curl -fsS -b "$jar" -X PATCH "$BASE/v1/admin/users/$jada" \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"Jada C","reading_tier":"adult"}' \
  | grep -q '"reading_tier":"adult"' || fail "edit learner"
code="$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X PATCH "$BASE/v1/admin/users/$jada" \
  -H 'Content-Type: application/json' -d '{"username":"admin"}')"
[ "$code" = "409" ] || fail "expected 409 on a username clash, got $code"
curl -fsS -b "$jar" -X POST "$BASE/v1/admin/learners/$jada/pin" \
  -H 'Content-Type: application/json' -d '{"pin":"1234"}' || fail "reset pin"

echo "--- the learner's progress, skills and code are visible to the admin"
# Every endpoint answers either way. Whether there is progress to show depends on the
# stack serving a real curriculum: Compose uses the published content image, while the
# chart job serves content-base, whose manifest declares no courses at all.
for path in progress activity submissions skills; do
  curl -fsS -b "$jar" "$BASE/v1/learners/$jada/$path" > /dev/null || fail "learner $path"
done
curl -fsS -b "$jar" "$BASE/v1/reports/$jada" | grep -q questions_to_ask || fail "report"

courses="$(curl -fsS "$BASE/content/manifest.json" \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["courses"]))')"
if [ "$courses" -gt 0 ]; then
  step="py.printing.say-hello.say-hello"
  # The API loads the step index on its own schedule; a new stack can answer requests a
  # few seconds before it holds the curriculum the browser already sees.
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -b "$learner_jar" -X POST "$BASE/v1/submissions" \
      -H 'Content-Type: application/json' \
      -d "{\"step_id\":\"$step\",\"code\":\"print(\\\"Hello\\\")\",\"eval_result\":{\"passed\":true,\"cases\":[]}}")"
    [ "$code" = "200" ] && break
    sleep 2
  done
  [ "$code" = "200" ] || fail "submission ($code)"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  curl -fsS -b "$learner_jar" -X POST "$BASE/v1/events" -H 'Content-Type: application/json' \
    -d "{\"events\":[{\"event_type\":\"step_started\",\"step_id\":\"$step\",\"occurred_at\":\"${started}\"}]}" \
    | grep -q '"accepted":1' || fail "step_started"
  curl -fsS -b "$jar" "$BASE/v1/learners/$jada/progress" | grep -q '"lesson_id":"say-hello"' \
    || fail "progress rollup"
  curl -fsS -b "$jar" "$BASE/v1/learners/$jada/activity" | grep -q step_started || fail "activity"
  curl -fsS -b "$jar" "$BASE/v1/learners/$jada/submissions" | grep -q 'print' \
    || fail "submissions"
  curl -fsS -b "$jar" "$BASE/v1/learners/$jada/skills" | grep -q print-output \
    || fail "learner skills"
else
  echo "    (no courses served here — progress contents not checked)"
fi

echo "--- a second adult sees only the learners linked to them"
curl -fsS -b "$jar" -X POST "$BASE/v1/admin/adults" -H 'Content-Type: application/json' \
  -d '{"username":"sam","display_name":"Sam","password":"sam-password-1"}' \
  | grep -q userId || fail "create adult"
sam_jar="$(mktemp)"
sam_login="$(curl -fsS -c "$sam_jar" -X POST "$BASE/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"org":"home","username":"sam","method":"password","secret":"sam-password-1"}')"
sam="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["user_id"])' <<<"$sam_login")"
code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sam_jar" "$BASE/v1/learners/$jada/progress")"
[ "$code" = "403" ] || fail "an unlinked adult read a learner's progress ($code)"
code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sam_jar" -X POST "$BASE/v1/admin/adults" \
  -H 'Content-Type: application/json' -d '{"username":"x","display_name":"X","password":"xxxxxxxx"}')"
[ "$code" = "403" ] || fail "a non-admin adult created an adult ($code)"
curl -fsS -b "$jar" -X PUT "$BASE/v1/admin/guardianship" -H 'Content-Type: application/json' \
  -d "{\"adult_id\":\"$sam\",\"learner_id\":\"$jada\"}" || fail "link"
curl -fsS -b "$sam_jar" "$BASE/v1/learners/$jada/progress" > /dev/null \
  || fail "a linked adult could not read their learner's progress"
curl -fsS -b "$sam_jar" "$BASE/v1/admin/users" | grep -q '"username":"jada"' \
  || fail "a linked adult could not see their learner"

echo "--- the last admin cannot remove themself, but can remove another adult"
admin_id="$(curl -fsS -b "$jar" "$BASE/v1/me" | python3 -c 'import json,sys; print(json.load(sys.stdin)["user_id"])')"
code="$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X DELETE "$BASE/v1/admin/users/$admin_id")"
[ "$code" = "409" ] || fail "the admin removed themself ($code)"
curl -fsS -b "$jar" -X DELETE "$BASE/v1/admin/users/$sam" || fail "remove adult"
code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sam_jar" "$BASE/v1/me")"
[ "$code" = "401" ] || fail "a removed adult's session still works ($code)"

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

echo "--- the admin sees the lock, and unlocking lets the learner back in"
curl -fsS -b "$jar" "$BASE/v1/admin/users" | python3 -c '
import json, sys
jada = next(p for p in json.load(sys.stdin) if p["username"] == "jada")
sys.exit(0 if jada["locked"] else 1)' || fail "the lock is not visible to the admin"
curl -fsS -b "$jar" -X POST "$BASE/v1/admin/learners/$jada/unlock" || fail "unlock"
curl -fsS -X POST "$BASE/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"org":"home","username":"jada","method":"pin","secret":"1234"}' \
  | grep -q '"role":"learner"' || fail "the learner could not sign in after unlock"

echo
echo "SMOKE PASSED against $BASE"
