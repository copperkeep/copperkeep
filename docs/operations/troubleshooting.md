# Troubleshooting

## "Infinite loops freeze the lesson" / the runtime restarts constantly

`crossOriginIsolated` is false, so `SharedArrayBuffer` is unavailable and `interrupt()`
falls back to terminating the worker — a 5-12 second Pyodide restart each time.

Check, in order:

1. Open `/#conformance`. It prints `crossOriginIsolated` directly.
2. `curl -I https://learn.example.com/` — you must see both
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`.
3. If they are missing, something in front of the web service is stripping them. Set
   `ingress.crossOriginIsolationHeaders=true` (ingress-nginx) or fix the proxy.
4. If you are on `http://192.168.x.x`, that is the cause: a private IP over HTTP is not
   a secure context. See [install.md](install.md).

## The API never becomes ready

`GET /readyz` names which check failed.

- `"contentLoaded": false` — the API cannot reach the content service. It keeps serving
  on its last-good copy by design; learners keep their sessions and new lessons do not
  load. Check the content pod and `COPPERKEEP_CONTENT_BASE_URL`.
- `"contentCompatible": false` — the curriculum's `minAppVersion` is newer than this app.
  This is the guard working. Upgrade the app, or roll the curriculum back.
- `"database": false` — Postgres. Check the credentials secret and that the migration Job
  completed.

## `helm install` fails: "PVC is not Bound"

The backup claim. Most storage classes — k3s `local-path`, the default EBS class —
bind `WaitForFirstConsumer`, and nothing mounts that claim until the nightly CronJob
runs, so it sits Pending and `--wait` gives up.

Point it at a claim you already have, which is the better answer anyway:

```sh
--set postgres.backup.existingClaim=copperkeep-backups-nas
```

A chart-created claim lands on the same storage as the database, and a backup on the
same disk as the database is not a backup.

## A learner is locked out

By design: ten failed PIN attempts hard-locks a learner account, and only the owning
adult can clear it — never a timer, never self-service.

```sh
curl -X POST -b adult.cookies https://learn.example.com/v1/admin/learners/<id>/unlock
```

Adult accounts back off exponentially but never hard-lock, because there may be nobody
above them. Recovery codes bypass the backoff.

If this happens repeatedly to one learner, look at the instructor view: a learner
enumerating classmates' accounts should be visible rather than silent.

## Events are being rejected

`POST /v1/events` returns a `rejected` array with a reason per event, and the API logs
each one. The reasons are all deliberate:

| Reason | Meaning |
|---|---|
| `unknown_step` | The step is not in the loaded content version. Usually a content/app version skew. |
| `prerequisites_not_held` | The learner has not mastered the step's prerequisites. |
| `submission_required` / `submission_not_found` | A `step_completed` must be backed by a stored submission. |
| `implausible_elapsed_time` | Completed less than two seconds after starting. |
| `occurred_in_future` / `too_old` | Device clock skew, or a very stale offline batch. |

A burst of these from one account is worth looking at. A steady trickle after a content
release is version skew.

## "Downloading Python…" appears every lesson

Storage is being evicted. Have the learner install the PWA — installed apps are granted
persistent storage far more readily than tabs — and confirm the site is served over
HTTPS, since `navigator.storage.persist()` needs a secure context.

On shared classroom tablets this is routine rather than exceptional. If a whole class is
cold-starting at once, the bottleneck is the access point, not the server.

## Generated hints never appear

Expected unless `tutor.enabled=true`. Even then, guidance fires only after the authored
ladder is exhausted, once per step, never on `predict` or `parsons` steps, and never on a
review item.

Beyond that, check `GET /healthz` on the tutor: if `guidanceEnabled` is false, the
startup latency probe measured a p95 above the budget and disabled guidance on purpose.
Also watch `copperkeep_hint_rejections_total` — a small local model that frequently
misses the output contract burns inference for no pedagogical gain, and the right answer
is to fall back to authored hints permanently.
