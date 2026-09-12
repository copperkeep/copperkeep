# 0003 — No Redis

**Status:** Accepted

## Context

Redis or Valkey is the reflex for sessions, rate limiting and caching.

An earlier draft justified leaving it out with "rate limiting is moot on a LAN." **That
reasoning was wrong and is recorded here because it was load-bearing at the time.** The
LAN is where the attacker sits: a student with DevTools and a five-line `fetch()` loop
is the realistic adversary, and a 4-digit PIN has a keyspace of 10,000. Throttling is
mandatory.

## Decision

No Redis. Sessions, credential-throttling counters, write quotas and the AI hint cache
all live in Postgres tables.

## Consequences

- One stateful component to back up, restore and reason about.
- Throttling is **not** optional: `auth_attempts` and `write_quota` are real tables with
  real enforcement, and hard locks are cleared only by the owning adult.
- At this scale — tens of learners on one box — Postgres counters are comfortably fast
  enough. If a deployment ever outgrows that, the interfaces are narrow enough to move.
- There is no job queue because there is no executor ([0001](0001-client-side-execution.md)),
  so the usual second reason for Redis does not arise either.
